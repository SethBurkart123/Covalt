from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Literal

import yaml
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey as Ed25519Verifier

from .. import db
from ..config import get_db_directory

logger = logging.getLogger(__name__)

PROVIDER_PLUGIN_STATE_KEY = "provider_plugin_states"
SUPPORTED_PROVIDER_PLUGIN_MANIFEST_VERSIONS = {"1"}
MAX_PROVIDER_PLUGIN_SIZE_BYTES = 20 * 1024 * 1024
_PROVIDER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_SIGNING_KEY_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")
SUPPORTED_SIGNATURE_ALGORITHMS = {"ed25519"}
SUPPORTED_POLICY_MODES = {"safe", "unsafe"}
SUPPORTED_SOURCE_CLASSES = {"official", "community"}
SUPPORTED_AUTO_UPDATE_OVERRIDES = {"inherit", "enabled", "disabled"}
_SIGNATURE_MANIFEST_FIELDS = {"signature", "signing_key_id", "signature_algorithm"}

_VERIFIED_TRUST_STATUS = "verified"
_UNSIGNED_TRUST_STATUS = "unsigned"
_UNTRUSTED_TRUST_STATUS = "untrusted"
_INVALID_TRUST_STATUS = "invalid"

_PROVIDER_PLUGIN_TRUSTED_KEYS_RELATIVE_PATH = Path("providers") / "provider_plugin_trusted_keys.json"

_trusted_signing_keys_cache: dict[str, Ed25519Verifier] | None = None
_trusted_signing_keys_mtime: float | None = None


@dataclass(frozen=True)
class ProviderPluginPolicy:
    mode: Literal["safe", "unsafe"] = "safe"
    auto_update_enabled: bool = False


@dataclass(frozen=True)
class ProviderPluginIndexEntry:
    id: str
    name: str
    url: str
    source_class: Literal["official", "community"] = "community"
    built_in: bool = False


@dataclass(frozen=True)
class ProviderPluginSourceEntry:
    id: str
    plugin_id: str
    name: str
    version: str
    provider: str
    description: str
    icon: str
    source_class: Literal["official", "community"] = "community"
    index_id: str | None = None
    index_name: str | None = None
    source_url: str | None = None
    repo_url: str | None = None
    tracking_ref: str | None = None
    plugin_path: str | None = None


@dataclass(frozen=True)
class ProviderPluginUpdateResult:
    id: str
    status: Literal["updated", "skipped", "failed"]
    message: str | None = None


_DEFAULT_PROVIDER_PLUGIN_POLICY = ProviderPluginPolicy()
_PROVIDER_PLUGIN_POLICY_KEY = "provider_plugin_policy"
_PROVIDER_PLUGIN_INDEXES_KEY = "provider_plugin_indexes"
_OFFICIAL_PROVIDER_PLUGIN_INDEX_ID = "official-index"

_BUILTIN_PROVIDER_PLUGIN_INDEXES: tuple[ProviderPluginIndexEntry, ...] = (
    ProviderPluginIndexEntry(
        id=_OFFICIAL_PROVIDER_PLUGIN_INDEX_ID,
        name="Official Provider Index",
        url="builtin://official-provider-index",
        source_class="official",
        built_in=True,
    ),
)

_BUILTIN_PROVIDER_PLUGIN_SOURCES: tuple[ProviderPluginSourceEntry, ...] = (
    ProviderPluginSourceEntry(
        id="sample-openai-adapter",
        plugin_id="sample_openai_adapter",
        name="Sample OpenAI Adapter Provider",
        version="0.1.0",
        provider="sample_openai_adapter",
        description="Template plugin using adapter-based provider manifest.",
        icon="openai",
        source_class="official",
        index_id=_OFFICIAL_PROVIDER_PLUGIN_INDEX_ID,
        index_name="Official Provider Index",
        source_url="builtin://official-provider-index",
        plugin_path="examples/provider-plugins/sample-openai-adapter",
    ),
    ProviderPluginSourceEntry(
        id="sample-code-provider",
        plugin_id="sample_code_provider",
        name="Sample Code Provider",
        version="0.1.0",
        provider="sample_code_provider",
        description="Template plugin with custom Python provider factory entrypoint.",
        icon="openai",
        source_class="official",
        index_id=_OFFICIAL_PROVIDER_PLUGIN_INDEX_ID,
        index_name="Official Provider Index",
        source_url="builtin://official-provider-index",
        plugin_path="examples/provider-plugins/sample-code-provider",
    ),
)


@dataclass(frozen=True)
class ProviderPluginManifest:
    id: str
    name: str
    version: str
    provider: str
    entrypoint: str | None
    adapter: str | None
    adapter_config: dict[str, Any]
    aliases: list[str]
    description: str
    icon: str
    auth_type: str
    default_base_url: str | None
    default_enabled: bool
    oauth_variant: str | None
    oauth_enterprise_domain: bool
    signature: str | None
    signing_key_id: str | None
    signature_algorithm: str | None
    path: Path
    raw: dict[str, Any]

    @classmethod
    def parse(cls, raw: dict[str, Any], *, path: Path) -> "ProviderPluginManifest":
        manifest_version = str(raw.get("manifest_version", "1"))
        if manifest_version not in SUPPORTED_PROVIDER_PLUGIN_MANIFEST_VERSIONS:
            raise ValueError(f"Unsupported provider plugin manifest version: {manifest_version}")

        plugin_id = str(raw.get("id") or "").strip().lower()
        if not plugin_id:
            raise ValueError("Provider plugin manifest missing required field: id")
        if not _PLUGIN_ID_RE.match(plugin_id):
            raise ValueError("Provider plugin id must match ^[a-z0-9][a-z0-9_-]*$")

        name = str(raw.get("name") or "").strip()
        if not name:
            raise ValueError("Provider plugin manifest missing required field: name")

        version = str(raw.get("version") or "").strip()
        if not version:
            raise ValueError("Provider plugin manifest missing required field: version")

        provider = str(raw.get("provider") or plugin_id).strip().lower().replace("-", "_")
        if not _PROVIDER_ID_RE.match(provider):
            raise ValueError("Provider id must match ^[a-z0-9][a-z0-9_]*$")

        entrypoint = raw.get("entrypoint")
        adapter = raw.get("adapter")
        if bool(entrypoint) == bool(adapter):
            raise ValueError(
                "Provider plugin manifest must define exactly one of 'entrypoint' or 'adapter'"
            )

        entrypoint_value: str | None = None
        if entrypoint is not None:
            entrypoint_value = str(entrypoint).strip()
            if ":" not in entrypoint_value:
                raise ValueError("Provider plugin entrypoint must be in format 'module:function'")

        adapter_value: str | None = None
        if adapter is not None:
            adapter_value = str(adapter).strip()
            if not adapter_value:
                raise ValueError("Provider plugin adapter cannot be empty")

        raw_adapter_config = raw.get("adapter_config") or {}
        if not isinstance(raw_adapter_config, dict):
            raise ValueError("adapter_config must be an object")

        raw_aliases = raw.get("aliases") or []
        if not isinstance(raw_aliases, list):
            raise ValueError("aliases must be a list")
        aliases = [str(alias).strip() for alias in raw_aliases if str(alias).strip()]

        auth_type = str(raw.get("auth_type") or "apiKey")
        if auth_type not in {"apiKey", "oauth"}:
            raise ValueError("auth_type must be either 'apiKey' or 'oauth'")

        oauth_variant = raw.get("oauth_variant")
        if oauth_variant is not None:
            oauth_variant = str(oauth_variant)
            if oauth_variant not in {"panel", "compact", "inline-code", "device"}:
                raise ValueError("oauth_variant must be one of: panel, compact, inline-code, device")

        default_enabled = raw.get("default_enabled", True)
        if not isinstance(default_enabled, bool):
            raise ValueError("default_enabled must be a boolean")

        default_base_url = raw.get("default_base_url")
        if default_base_url is not None:
            default_base_url = str(default_base_url).strip() or None

        signature = raw.get("signature")
        signing_key_id = raw.get("signing_key_id")
        signature_algorithm = raw.get("signature_algorithm")

        signature_value: str | None = None
        signing_key_id_value: str | None = None
        signature_algorithm_value: str | None = None

        if signature is not None:
            signature_value = str(signature).strip()
            if not signature_value:
                raise ValueError("signature cannot be empty")
            _decode_base64(signature_value, field_name="signature")

            signing_key_id_value = str(signing_key_id or "").strip()
            if not signing_key_id_value:
                raise ValueError("signing_key_id is required when signature is provided")
            if not _SIGNING_KEY_ID_RE.match(signing_key_id_value):
                raise ValueError(
                    "signing_key_id must match ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
                )

            signature_algorithm_value = str(signature_algorithm or "ed25519").strip().lower()
            if signature_algorithm_value not in SUPPORTED_SIGNATURE_ALGORITHMS:
                raise ValueError(
                    "signature_algorithm must be one of: "
                    + ", ".join(sorted(SUPPORTED_SIGNATURE_ALGORITHMS))
                )
        else:
            if signing_key_id is not None:
                raise ValueError("signing_key_id requires signature")
            if signature_algorithm is not None:
                raise ValueError("signature_algorithm requires signature")

        description = str(raw.get("description") or f"{name} provider plugin")
        icon = str(raw.get("icon") or provider.replace("_", "-"))

        return cls(
            id=plugin_id,
            name=name,
            version=version,
            provider=provider,
            entrypoint=entrypoint_value,
            adapter=adapter_value,
            adapter_config=dict(raw_adapter_config),
            aliases=aliases,
            description=description,
            icon=icon,
            auth_type=auth_type,
            default_base_url=default_base_url,
            default_enabled=default_enabled,
            oauth_variant=oauth_variant,
            oauth_enterprise_domain=bool(raw.get("oauth_enterprise_domain", False)),
            signature=signature_value,
            signing_key_id=signing_key_id_value,
            signature_algorithm=signature_algorithm_value,
            path=path,
            raw=dict(raw),
        )


@dataclass(frozen=True)
class ProviderPluginVerificationResult:
    status: str
    message: str | None
    signing_key_id: str | None


@dataclass(frozen=True)
class ProviderPluginInfo:
    id: str
    name: str
    version: str
    provider: str
    enabled: bool
    blocked_by_policy: bool
    installed_at: str | None
    source_type: str | None
    source_ref: str | None
    source_class: str
    index_id: str | None
    repo_url: str | None
    tracking_ref: str | None
    plugin_path: str | None
    auto_update_override: str
    effective_auto_update: bool
    description: str
    icon: str
    auth_type: str
    default_base_url: str | None
    default_enabled: bool
    oauth_variant: str | None
    oauth_enterprise_domain: bool
    aliases: list[str]
    verification_status: str
    verification_message: str | None
    signing_key_id: str | None
    update_error: str | None = None
    error: str | None = None


def get_provider_plugins_directory() -> Path:
    plugins_dir = get_db_directory() / "provider_plugins"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    return plugins_dir


def get_provider_plugin_directory(plugin_id: str) -> Path:
    return get_provider_plugins_directory() / plugin_id


def get_provider_plugin_trusted_keys_path() -> Path:
    return Path(__file__).resolve().parents[1] / _PROVIDER_PLUGIN_TRUSTED_KEYS_RELATIVE_PATH


def _decode_base64(value: str, *, field_name: str) -> bytes:
    try:
        return base64.b64decode(value.encode("utf-8"), validate=True)
    except Exception as exc:
        raise ValueError(f"{field_name} must be valid base64") from exc


def _normalize_source_class(value: Any) -> Literal["official", "community"]:
    raw = str(value or "community").strip().lower()
    if raw not in SUPPORTED_SOURCE_CLASSES:
        return "community"
    return raw  # type: ignore[return-value]


def _normalize_policy_mode(value: Any) -> Literal["safe", "unsafe"]:
    raw = str(value or "safe").strip().lower()
    if raw not in SUPPORTED_POLICY_MODES:
        return "safe"
    return raw  # type: ignore[return-value]


def _normalize_auto_update_override(value: Any) -> Literal["inherit", "enabled", "disabled"]:
    raw = str(value or "inherit").strip().lower()
    if raw not in SUPPORTED_AUTO_UPDATE_OVERRIDES:
        return "inherit"
    return raw  # type: ignore[return-value]


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_tracking_ref(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    return raw or None


def _normalize_plugin_path(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().strip("/")
    return raw or None


def _is_http_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def _normalize_repo_url(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError("repoUrl is required")
    if not _is_http_url(raw):
        raise ValueError("repoUrl must be an http(s) URL")
    if raw.endswith(".git"):
        raw = raw[:-4]
    return raw.rstrip("/")


def _slugify(value: str) -> str:
    lowered = value.strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return cleaned or f"index-{uuid.uuid4().hex[:8]}"


def _safe_index_id(name: str) -> str:
    slug = _slugify(name)
    return f"custom-{slug}"


def _validate_index_url(url: str) -> str:
    normalized = url.strip()
    if not _is_http_url(normalized):
        raise ValueError("Index URL must use http:// or https://")
    return normalized


def _load_provider_plugin_policy() -> ProviderPluginPolicy:
    try:
        with db.db_session() as sess:
            raw = db.get_user_setting(sess, _PROVIDER_PLUGIN_POLICY_KEY)
    except Exception:
        return _DEFAULT_PROVIDER_PLUGIN_POLICY
    if not raw:
        return _DEFAULT_PROVIDER_PLUGIN_POLICY
    try:
        parsed = json.loads(raw)
    except Exception:
        return _DEFAULT_PROVIDER_PLUGIN_POLICY
    if not isinstance(parsed, dict):
        return _DEFAULT_PROVIDER_PLUGIN_POLICY
    return ProviderPluginPolicy(
        mode=_normalize_policy_mode(parsed.get("mode")),
        auto_update_enabled=_truthy(parsed.get("auto_update_enabled", False)),
    )


def _save_provider_plugin_policy(policy: ProviderPluginPolicy) -> None:
    payload = {
        "mode": policy.mode,
        "auto_update_enabled": bool(policy.auto_update_enabled),
    }
    try:
        with db.db_session() as sess:
            db.set_user_setting(sess, _PROVIDER_PLUGIN_POLICY_KEY, json.dumps(payload))
    except Exception:
        return


def _parse_index_entry(raw: dict[str, Any]) -> ProviderPluginIndexEntry | None:
    idx_id = str(raw.get("id") or "").strip()
    name = str(raw.get("name") or "").strip()
    url = str(raw.get("url") or "").strip()
    if not idx_id or not name or not url:
        return None
    return ProviderPluginIndexEntry(
        id=idx_id,
        name=name,
        url=url,
        source_class=_normalize_source_class(raw.get("source_class")),
        built_in=_truthy(raw.get("built_in", False)),
    )


def _load_custom_indexes() -> list[ProviderPluginIndexEntry]:
    try:
        with db.db_session() as sess:
            raw = db.get_user_setting(sess, _PROVIDER_PLUGIN_INDEXES_KEY)
    except Exception:
        return []
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    result: list[ProviderPluginIndexEntry] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, dict):
            continue
        entry = _parse_index_entry(item)
        if entry is None:
            continue
        if entry.id in seen:
            continue
        seen.add(entry.id)
        result.append(entry)
    return result


def _save_custom_indexes(entries: list[ProviderPluginIndexEntry]) -> None:
    payload = [
        {
            "id": item.id,
            "name": item.name,
            "url": item.url,
            "source_class": item.source_class,
            "built_in": bool(item.built_in),
        }
        for item in entries
        if not item.built_in
    ]
    try:
        with db.db_session() as sess:
            db.set_user_setting(sess, _PROVIDER_PLUGIN_INDEXES_KEY, json.dumps(payload))
    except Exception:
        return


def _source_entry_to_dict(entry: ProviderPluginSourceEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "plugin_id": entry.plugin_id,
        "name": entry.name,
        "version": entry.version,
        "provider": entry.provider,
        "description": entry.description,
        "icon": entry.icon,
        "source_class": entry.source_class,
        "index_id": entry.index_id,
        "index_name": entry.index_name,
        "source_url": entry.source_url,
        "repo_url": entry.repo_url,
        "tracking_ref": entry.tracking_ref,
        "plugin_path": entry.plugin_path,
    }


def _entry_from_raw(raw: dict[str, Any], *, fallback_index: ProviderPluginIndexEntry) -> ProviderPluginSourceEntry | None:
    source_id = str(raw.get("id") or "").strip()
    plugin_id = str(raw.get("pluginId") or raw.get("plugin_id") or "").strip()
    name = str(raw.get("name") or "").strip()
    version = str(raw.get("version") or "").strip()
    provider = str(raw.get("provider") or "").strip()
    description = str(raw.get("description") or "").strip()
    icon = str(raw.get("icon") or "openai").strip() or "openai"
    if not source_id or not plugin_id or not name or not provider:
        return None

    return ProviderPluginSourceEntry(
        id=source_id,
        plugin_id=plugin_id,
        name=name,
        version=version or "0.0.0",
        provider=provider,
        description=description or name,
        icon=icon,
        source_class=_normalize_source_class(raw.get("sourceClass") or raw.get("source_class") or fallback_index.source_class),
        index_id=str(raw.get("indexId") or raw.get("index_id") or fallback_index.id),
        index_name=str(raw.get("indexName") or raw.get("index_name") or fallback_index.name),
        source_url=str(raw.get("sourceUrl") or raw.get("source_url") or fallback_index.url),
        repo_url=str(raw.get("repoUrl") or raw.get("repo_url") or "").strip() or None,
        tracking_ref=_normalize_tracking_ref(raw.get("trackingRef") or raw.get("tracking_ref")),
        plugin_path=_normalize_plugin_path(raw.get("pluginPath") or raw.get("plugin_path")),
    )


def _extract_sources_from_index_payload(
    payload: Any,
    *,
    fallback_index: ProviderPluginIndexEntry,
) -> list[ProviderPluginSourceEntry]:
    records: list[Any] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("sources"), list):
            records = payload.get("sources")
        elif isinstance(payload.get("plugins"), list):
            records = payload.get("plugins")
    elif isinstance(payload, list):
        records = payload

    result: list[ProviderPluginSourceEntry] = []
    seen: set[str] = set()
    for item in records:
        if not isinstance(item, dict):
            continue
        entry = _entry_from_raw(item, fallback_index=fallback_index)
        if entry is None or entry.id in seen:
            continue
        seen.add(entry.id)
        result.append(entry)
    return result


def _fetch_index_sources(index: ProviderPluginIndexEntry) -> list[ProviderPluginSourceEntry]:
    if index.url.startswith("builtin://"):
        return [item for item in _BUILTIN_PROVIDER_PLUGIN_SOURCES if item.index_id == index.id]

    try:
        with urllib.request.urlopen(index.url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        logger.warning("Failed to fetch provider plugin index %s: %s", index.url, exc)
        return []

    return _extract_sources_from_index_payload(payload, fallback_index=index)


def _extract_github_owner_repo(repo_url: str) -> tuple[str, str]:
    normalized = _normalize_repo_url(repo_url)
    parsed = urllib.parse.urlparse(normalized)
    host = (parsed.netloc or "").strip().lower()
    if host != "github.com":
        raise ValueError("Only GitHub repositories are supported for repo installs")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError("repoUrl must include owner and repo")
    return parts[0], parts[1]


def _download_github_archive(repo_url: str, ref: str) -> bytes:
    owner, repo = _extract_github_owner_repo(repo_url)
    safe_ref = (ref or "main").strip() or "main"
    archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{safe_ref}"

    try:
        with urllib.request.urlopen(archive_url, timeout=20) as response:
            return response.read()
    except Exception:
        fallback_url = f"https://codeload.github.com/{owner}/{repo}/zip/{safe_ref}"
        with urllib.request.urlopen(fallback_url, timeout=20) as response:
            return response.read()


def _collect_files_for_zip(base_dir: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(base_dir.rglob("*")):
            if not file_path.is_file():
                continue
            rel_path = file_path.relative_to(base_dir).as_posix()
            zf.write(file_path, arcname=rel_path)
    return buffer.getvalue()


def _normalize_plugin_path_in_archive(path: str | None) -> str | None:
    if path is None:
        return None
    normalized = path.strip().strip("/")
    if not normalized:
        return None
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError("pluginPath must be a safe relative path")
    return pure.as_posix()


def _resolve_effective_auto_update(
    *,
    override: str,
    policy_auto_update_enabled: bool,
) -> bool:
    normalized = _normalize_auto_update_override(override)
    if normalized == "enabled":
        return True
    if normalized == "disabled":
        return False
    return bool(policy_auto_update_enabled)



def _load_trusted_signing_keys() -> dict[str, Ed25519Verifier]:
    global _trusted_signing_keys_cache, _trusted_signing_keys_mtime

    path = get_provider_plugin_trusted_keys_path()
    if not path.exists() or not path.is_file():
        _trusted_signing_keys_cache = {}
        _trusted_signing_keys_mtime = None
        return {}

    mtime = path.stat().st_mtime
    if _trusted_signing_keys_cache is not None and _trusted_signing_keys_mtime == mtime:
        return dict(_trusted_signing_keys_cache)

    try:
        payload = json.loads(path.read_text())
    except Exception as exc:
        logger.warning("Failed to parse provider plugin keyring %s: %s", path, exc)
        _trusted_signing_keys_cache = {}
        _trusted_signing_keys_mtime = mtime
        return {}

    result: dict[str, Ed25519Verifier] = {}

    if isinstance(payload, dict) and isinstance(payload.get("keys"), list):
        for item in payload["keys"]:
            if not isinstance(item, dict):
                continue
            signer_id = str(item.get("id") or "").strip()
            signer_material_raw = str(item.get("key") or "").strip()
            if not signer_id or not signer_material_raw:
                continue
            if not _SIGNING_KEY_ID_RE.match(signer_id):
                continue
            try:
                signer_material_bytes = _decode_base64(
                    signer_material_raw,
                    field_name="signer_material",
                )
                result[signer_id] = Ed25519Verifier.from_public_bytes(signer_material_bytes)
            except Exception as exc:
                logger.warning(
                    "Skipping invalid provider plugin signer '%s': %s",
                    signer_id,
                    exc,
                )
    elif isinstance(payload, dict):
        for signer_id, signer_material_raw in payload.items():
            if not isinstance(signer_id, str) or not isinstance(signer_material_raw, str):
                continue
            normalized_signer_id = signer_id.strip()
            if not normalized_signer_id or not _SIGNING_KEY_ID_RE.match(normalized_signer_id):
                continue
            try:
                signer_material_bytes = _decode_base64(
                    signer_material_raw.strip(),
                    field_name="signer_material",
                )
                result[normalized_signer_id] = Ed25519Verifier.from_public_bytes(
                    signer_material_bytes
                )
            except Exception as exc:
                logger.warning(
                    "Skipping invalid provider plugin signer '%s': %s",
                    normalized_signer_id,
                    exc,
                )

    _trusted_signing_keys_cache = dict(result)
    _trusted_signing_keys_mtime = mtime
    return result


def _load_plugin_states() -> dict[str, dict[str, Any]]:
    with db.db_session() as sess:
        raw = db.get_user_setting(sess, PROVIDER_PLUGIN_STATE_KEY)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for key, value in parsed.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        result[key] = value
    return result


def _save_plugin_states(states: dict[str, dict[str, Any]]) -> None:
    with db.db_session() as sess:
        db.set_user_setting(sess, PROVIDER_PLUGIN_STATE_KEY, json.dumps(states))


class ProviderPluginManager:
    def __init__(self) -> None:
        self.plugins_dir = get_provider_plugins_directory()

    def get_policy(self) -> ProviderPluginPolicy:
        return _load_provider_plugin_policy()

    def save_policy(
        self,
        *,
        mode: str,
        auto_update_enabled: bool,
    ) -> ProviderPluginPolicy:
        policy = ProviderPluginPolicy(
            mode=_normalize_policy_mode(mode),
            auto_update_enabled=bool(auto_update_enabled),
        )
        _save_provider_plugin_policy(policy)
        return policy

    def list_indexes(self) -> list[ProviderPluginIndexEntry]:
        indexes = list(_BUILTIN_PROVIDER_PLUGIN_INDEXES) + _load_custom_indexes()
        seen: set[str] = set()
        deduped: list[ProviderPluginIndexEntry] = []
        for item in indexes:
            if item.id in seen:
                continue
            seen.add(item.id)
            deduped.append(item)
        return deduped

    def add_index(self, *, name: str, url: str) -> ProviderPluginIndexEntry:
        normalized_name = str(name or "").strip()
        if not normalized_name:
            raise ValueError("Index name is required")
        normalized_url = _validate_index_url(url)

        custom = _load_custom_indexes()
        used_ids = {item.id for item in custom}

        base_id = _safe_index_id(normalized_name)
        index_id = base_id
        suffix = 2
        while index_id in used_ids or any(index_id == item.id for item in _BUILTIN_PROVIDER_PLUGIN_INDEXES):
            index_id = f"{base_id}-{suffix}"
            suffix += 1

        created = ProviderPluginIndexEntry(
            id=index_id,
            name=normalized_name,
            url=normalized_url,
            source_class="community",
            built_in=False,
        )
        custom.append(created)
        _save_custom_indexes(custom)
        return created

    def remove_index(self, index_id: str) -> bool:
        normalized = str(index_id or "").strip()
        if not normalized:
            return False
        if any(item.id == normalized and item.built_in for item in _BUILTIN_PROVIDER_PLUGIN_INDEXES):
            raise ValueError("Built-in indexes cannot be removed")

        custom = _load_custom_indexes()
        next_custom = [item for item in custom if item.id != normalized]
        if len(next_custom) == len(custom):
            return False
        _save_custom_indexes(next_custom)
        return True

    def refresh_index(self, index_id: str) -> int:
        index = next((item for item in self.list_indexes() if item.id == index_id), None)
        if index is None:
            raise ValueError(f"Provider plugin index '{index_id}' not found")
        return len(_fetch_index_sources(index))

    def list_sources(self) -> list[ProviderPluginSourceEntry]:
        entries: list[ProviderPluginSourceEntry] = []
        seen: set[str] = set()
        for index in self.list_indexes():
            for item in _fetch_index_sources(index):
                if item.id in seen:
                    continue
                seen.add(item.id)
                entries.append(item)
        return sorted(entries, key=lambda item: (item.source_class != "official", item.name.lower()))

    def get_source(self, source_id: str) -> ProviderPluginSourceEntry | None:
        normalized = str(source_id or "").strip()
        if not normalized:
            return None
        for source in self.list_sources():
            if source.id == normalized:
                return source
        return None

    def is_install_blocked_by_policy(self, source_class: str) -> bool:
        return self._is_policy_blocked(source_class=source_class, policy=self.get_policy())

    def install_source(self, source_id: str) -> str:
        source = self.get_source(source_id)
        if source is None:
            raise ValueError(f"Unknown provider plugin source '{source_id}'")

        if source.plugin_path and str(source.source_url or "").startswith("builtin://"):
            root = Path(__file__).resolve().parents[2]
            directory = root / source.plugin_path
            if not directory.exists():
                raise ValueError(f"Provider plugin source path not found: {directory}")
            return self.import_from_directory(
                directory,
                source_type="source",
                source_ref=source.id,
                source_class=source.source_class,
                index_id=source.index_id,
                repo_url=source.repo_url,
                tracking_ref=source.tracking_ref,
                plugin_path=source.plugin_path,
            )

        if source.repo_url:
            return self.install_from_repo(
                repo_url=source.repo_url,
                ref=source.tracking_ref or "main",
                plugin_path=source.plugin_path,
                source_type="source",
                source_ref=source.id,
                source_class=source.source_class,
                index_id=source.index_id,
            )

        raise ValueError(f"Source '{source_id}' does not define a supported install path")

    def install_from_repo(
        self,
        *,
        repo_url: str,
        ref: str | None = "main",
        plugin_path: str | None = None,
        source_type: str = "repo",
        source_ref: str | None = None,
        source_class: str = "community",
        index_id: str | None = None,
        auto_update_override: str = "inherit",
    ) -> str:
        normalized_repo = _normalize_repo_url(repo_url)
        tracking_ref = _normalize_tracking_ref(ref) or "main"
        normalized_plugin_path = _normalize_plugin_path_in_archive(plugin_path)

        archive_bytes = _download_github_archive(normalized_repo, tracking_ref)
        with tempfile.TemporaryDirectory(prefix="provider-plugin-repo-") as tmp:
            tmp_dir = Path(tmp)
            archive_path = tmp_dir / "repo.zip"
            archive_path.write_bytes(archive_bytes)

            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(tmp_dir / "repo")

            extracted_roots = [path for path in (tmp_dir / "repo").iterdir() if path.is_dir()]
            if not extracted_roots:
                raise ValueError("Repository archive did not contain a valid root directory")
            repo_root = extracted_roots[0]

            install_root = repo_root / normalized_plugin_path if normalized_plugin_path else repo_root
            if not install_root.exists() or not install_root.is_dir():
                raise ValueError("pluginPath not found in repository archive")

            return self.import_from_directory(
                install_root,
                source_type=source_type,
                source_ref=source_ref or normalized_repo,
                source_class=source_class,
                index_id=index_id,
                repo_url=normalized_repo,
                tracking_ref=tracking_ref,
                plugin_path=normalized_plugin_path,
                auto_update_override=auto_update_override,
            )

    def list_plugins(self) -> list[ProviderPluginInfo]:
        states = _load_plugin_states()
        policy = self.get_policy()
        infos: list[ProviderPluginInfo] = []

        for plugin_dir in sorted(self.plugins_dir.iterdir(), key=lambda p: p.name.lower()):
            if not plugin_dir.is_dir():
                continue

            state = states.get(plugin_dir.name, {})
            try:
                infos.append(self._build_plugin_info(plugin_dir, state=state, policy=policy))
            except Exception as exc:
                source_class = _normalize_source_class(state.get("source_class"))
                blocked = self._is_policy_blocked(source_class=source_class, policy=policy)
                auto_update_override = _normalize_auto_update_override(
                    state.get("auto_update_override")
                )
                effective_auto_update = (
                    _resolve_effective_auto_update(
                        override=auto_update_override,
                        policy_auto_update_enabled=policy.auto_update_enabled,
                    )
                    and not blocked
                )
                infos.append(
                    ProviderPluginInfo(
                        id=plugin_dir.name,
                        name=plugin_dir.name,
                        version="unknown",
                        provider=plugin_dir.name,
                        enabled=bool(state.get("enabled", False)),
                        blocked_by_policy=blocked,
                        installed_at=state.get("installed_at") if isinstance(state, dict) else None,
                        source_type=state.get("source_type") if isinstance(state, dict) else None,
                        source_ref=state.get("source_ref") if isinstance(state, dict) else None,
                        source_class=source_class,
                        index_id=state.get("index_id") if isinstance(state, dict) else None,
                        repo_url=state.get("repo_url") if isinstance(state, dict) else None,
                        tracking_ref=_normalize_tracking_ref(state.get("tracking_ref")),
                        plugin_path=_normalize_plugin_path(state.get("plugin_path")),
                        auto_update_override=auto_update_override,
                        effective_auto_update=effective_auto_update,
                        description="Invalid provider plugin",
                        icon="openai",
                        auth_type="apiKey",
                        default_base_url=None,
                        default_enabled=False,
                        oauth_variant=None,
                        oauth_enterprise_domain=False,
                        aliases=[],
                        verification_status=_INVALID_TRUST_STATUS,
                        verification_message=str(exc),
                        signing_key_id=None,
                        update_error=state.get("update_error") if isinstance(state, dict) else None,
                        error=str(exc),
                    )
                )

        return sorted(infos, key=lambda item: item.name.lower())

    def get_plugin_info(self, plugin_id: str) -> ProviderPluginInfo | None:
        plugin_dir = get_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return None
        states = _load_plugin_states()
        state = states.get(plugin_dir.name, {})
        return self._build_plugin_info(plugin_dir, state=state, policy=self.get_policy())

    def get_enabled_manifests(self) -> list[ProviderPluginManifest]:
        states = _load_plugin_states()
        policy = self.get_policy()
        manifests: list[ProviderPluginManifest] = []

        for plugin_dir in sorted(self.plugins_dir.iterdir(), key=lambda p: p.name.lower()):
            if not plugin_dir.is_dir():
                continue
            try:
                manifest = self._read_manifest_from_directory(plugin_dir)
            except Exception as exc:
                logger.warning("Skipping invalid provider plugin %s: %s", plugin_dir, exc)
                continue

            state = states.get(manifest.id, {})
            enabled = bool(state.get("enabled", manifest.default_enabled))
            source_class = _normalize_source_class(state.get("source_class"))
            if enabled and not self._is_policy_blocked(source_class=source_class, policy=policy):
                manifests.append(manifest)

        return manifests

    def get_manifest(self, plugin_id: str) -> ProviderPluginManifest | None:
        plugin_dir = get_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return None
        return self._read_manifest_from_directory(plugin_dir)

    def import_from_zip(
        self,
        zip_data: bytes | Path,
        *,
        source_type: str = "zip",
        source_ref: str | None = None,
        source_class: str = "official",
        index_id: str | None = None,
        repo_url: str | None = None,
        tracking_ref: str | None = None,
        plugin_path: str | None = None,
        auto_update_override: str = "inherit",
    ) -> str:
        if isinstance(zip_data, Path):
            zip_bytes = zip_data.read_bytes()
            if source_ref is None:
                source_ref = str(zip_data)
        else:
            zip_bytes = zip_data

        if len(zip_bytes) > MAX_PROVIDER_PLUGIN_SIZE_BYTES:
            raise ValueError(
                f"Provider plugin archive exceeds {MAX_PROVIDER_PLUGIN_SIZE_BYTES} bytes"
            )

        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            manifest_data = self._find_and_parse_manifest(zf)
            manifest = ProviderPluginManifest.parse(manifest_data, path=Path("provider.yaml"))

            plugin_dir = get_provider_plugin_directory(manifest.id)
            if plugin_dir.exists():
                raise ValueError(f"Provider plugin '{manifest.id}' is already installed")

            root_prefix = self._detect_single_root_prefix(zf)
            try:
                plugin_dir.mkdir(parents=True, exist_ok=False)
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    rel_path = self._normalize_zip_path(info.filename, root_prefix)
                    if rel_path is None:
                        continue

                    content = zf.read(info.filename)
                    target = plugin_dir / rel_path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
            except Exception:
                if plugin_dir.exists():
                    shutil.rmtree(plugin_dir)
                raise

        self._set_state(
            manifest.id,
            enabled=manifest.default_enabled,
            source_type=source_type,
            source_ref=source_ref,
            source_class=source_class,
            index_id=index_id,
            repo_url=repo_url,
            tracking_ref=tracking_ref,
            plugin_path=plugin_path,
            auto_update_override=auto_update_override,
        )
        verification = self.get_plugin_verification(manifest.id)
        if verification and verification.status != "verified":
            logger.warning(
                "Provider plugin '%s' trust warning: %s",
                manifest.id,
                verification.message,
            )
        logger.info("Installed provider plugin '%s'", manifest.id)
        return manifest.id

    def import_from_directory(
        self,
        directory: Path,
        *,
        source_type: str = "local",
        source_ref: str | None = None,
        source_class: str = "official",
        index_id: str | None = None,
        repo_url: str | None = None,
        tracking_ref: str | None = None,
        plugin_path: str | None = None,
        auto_update_override: str = "inherit",
    ) -> str:
        manifest = self._read_manifest_from_directory(directory)

        target_dir = get_provider_plugin_directory(manifest.id)
        if target_dir.exists():
            raise ValueError(f"Provider plugin '{manifest.id}' is already installed")

        shutil.copytree(directory, target_dir)
        self._set_state(
            manifest.id,
            enabled=manifest.default_enabled,
            source_type=source_type,
            source_ref=source_ref or str(directory),
            source_class=source_class,
            index_id=index_id,
            repo_url=repo_url,
            tracking_ref=tracking_ref,
            plugin_path=plugin_path,
            auto_update_override=auto_update_override,
        )
        verification = self.get_plugin_verification(manifest.id)
        if verification and verification.status != "verified":
            logger.warning(
                "Provider plugin '%s' trust warning: %s",
                manifest.id,
                verification.message,
            )
        logger.info("Installed provider plugin '%s' from directory", manifest.id)
        return manifest.id

    def set_auto_update(
        self,
        plugin_id: str,
        *,
        override: str,
        tracking_ref: str | None = None,
    ) -> bool:
        manifest = self.get_manifest(plugin_id)
        if manifest is None:
            return False
        self._set_state(
            plugin_id,
            enabled=None,
            auto_update_override=override,
            tracking_ref=tracking_ref,
        )
        return True

    def run_update_check(self) -> list[ProviderPluginUpdateResult]:
        results: list[ProviderPluginUpdateResult] = []
        for plugin in self.list_plugins():
            if plugin.error:
                results.append(
                    ProviderPluginUpdateResult(
                        id=plugin.id,
                        status="skipped",
                        message="Plugin is invalid and cannot be updated",
                    )
                )
                continue

            if not plugin.enabled:
                results.append(
                    ProviderPluginUpdateResult(
                        id=plugin.id,
                        status="skipped",
                        message="Plugin is disabled",
                    )
                )
                continue

            if plugin.blocked_by_policy:
                results.append(
                    ProviderPluginUpdateResult(
                        id=plugin.id,
                        status="skipped",
                        message="Plugin updates are blocked by Safe mode policy",
                    )
                )
                continue

            if not plugin.effective_auto_update:
                results.append(
                    ProviderPluginUpdateResult(
                        id=plugin.id,
                        status="skipped",
                        message="Auto-update is disabled for this plugin",
                    )
                )
                continue

            try:
                if plugin.source_type == "repo" and plugin.repo_url:
                    self._update_from_repo(plugin)
                    results.append(
                        ProviderPluginUpdateResult(
                            id=plugin.id,
                            status="updated",
                            message="Updated from repository",
                        )
                    )
                elif plugin.source_type == "source" and plugin.source_ref:
                    source = self.get_source(plugin.source_ref)
                    if source and source.plugin_path and str(source.source_url or "").startswith("builtin://"):
                        root = Path(__file__).resolve().parents[2]
                        source_dir = root / source.plugin_path
                        if not source_dir.exists():
                            raise ValueError("Built-in source path no longer exists")
                        self._replace_plugin_from_directory(plugin.id, source_dir)
                        self._set_state(plugin.id, enabled=None, update_error=None)
                        results.append(
                            ProviderPluginUpdateResult(
                                id=plugin.id,
                                status="updated",
                                message="Updated from store source",
                            )
                        )
                    elif source and source.repo_url:
                        self._update_from_repo(plugin, source=source)
                        results.append(
                            ProviderPluginUpdateResult(
                                id=plugin.id,
                                status="updated",
                                message="Updated from source repository",
                            )
                        )
                    else:
                        results.append(
                            ProviderPluginUpdateResult(
                                id=plugin.id,
                                status="skipped",
                                message="Source does not support auto-update",
                            )
                        )
                else:
                    results.append(
                        ProviderPluginUpdateResult(
                            id=plugin.id,
                            status="skipped",
                            message="Source type does not support auto-update",
                        )
                    )
            except Exception as exc:
                self._set_state(plugin.id, enabled=None, update_error=str(exc))
                results.append(
                    ProviderPluginUpdateResult(
                        id=plugin.id,
                        status="failed",
                        message=str(exc),
                    )
                )

        return results

    def get_plugin_verification(self, plugin_id: str) -> ProviderPluginVerificationResult | None:
        plugin_dir = get_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return None
        manifest = self._read_manifest_from_directory(plugin_dir)
        return self._verify_plugin_directory(plugin_dir, manifest)

    def uninstall(self, plugin_id: str) -> bool:
        plugin_dir = get_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return False

        shutil.rmtree(plugin_dir)
        states = _load_plugin_states()
        if plugin_id in states:
            del states[plugin_id]
            _save_plugin_states(states)

        logger.info("Uninstalled provider plugin '%s'", plugin_id)
        return True

    def enable_plugin(self, plugin_id: str, enabled: bool = True) -> bool:
        manifest = self.get_manifest(plugin_id)
        if manifest is None:
            return False
        self._set_state(plugin_id, enabled=enabled)
        logger.info("%s provider plugin '%s'", "Enabled" if enabled else "Disabled", plugin_id)
        return True

    def _update_from_repo(
        self,
        plugin: ProviderPluginInfo,
        *,
        source: ProviderPluginSourceEntry | None = None,
    ) -> None:
        repo_url = source.repo_url if source and source.repo_url else plugin.repo_url
        if not repo_url:
            raise ValueError("Plugin is missing repo metadata")
        ref = (
            source.tracking_ref
            if source and source.tracking_ref
            else _normalize_tracking_ref(plugin.tracking_ref)
            or "main"
        )
        plugin_path = (
            source.plugin_path
            if source and source.plugin_path is not None
            else _normalize_plugin_path(plugin.plugin_path)
        )

        archive_bytes = _download_github_archive(repo_url, ref)
        with tempfile.TemporaryDirectory(prefix="provider-plugin-update-") as tmp:
            tmp_dir = Path(tmp)
            archive_path = tmp_dir / "repo.zip"
            archive_path.write_bytes(archive_bytes)

            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(tmp_dir / "repo")

            extracted_roots = [path for path in (tmp_dir / "repo").iterdir() if path.is_dir()]
            if not extracted_roots:
                raise ValueError("Repository archive did not contain a valid root directory")
            repo_root = extracted_roots[0]
            install_root = repo_root / plugin_path if plugin_path else repo_root
            if not install_root.exists() or not install_root.is_dir():
                raise ValueError("pluginPath not found in repository archive")

            self._replace_plugin_from_directory(plugin.id, install_root)

        self._set_state(
            plugin.id,
            enabled=None,
            repo_url=repo_url,
            tracking_ref=ref,
            plugin_path=plugin_path,
            update_error=None,
        )

    def _replace_plugin_from_directory(self, plugin_id: str, directory: Path) -> None:
        manifest = self._read_manifest_from_directory(directory)
        if manifest.id != plugin_id:
            raise ValueError(
                f"Updated plugin id mismatch (expected '{plugin_id}', got '{manifest.id}')"
            )

        target_dir = get_provider_plugin_directory(plugin_id)
        if target_dir.exists():
            shutil.rmtree(target_dir)
        shutil.copytree(directory, target_dir)

    def _is_policy_blocked(
        self,
        *,
        source_class: str,
        policy: ProviderPluginPolicy,
    ) -> bool:
        return policy.mode == "safe" and _normalize_source_class(source_class) != "official"

    def _set_state(
        self,
        plugin_id: str,
        *,
        enabled: bool | None,
        source_type: str | None = None,
        source_ref: str | None = None,
        source_class: str | None = None,
        index_id: str | None = None,
        repo_url: str | None = None,
        tracking_ref: str | None = None,
        plugin_path: str | None = None,
        auto_update_override: str | None = None,
        update_error: str | None = None,
    ) -> None:
        states = _load_plugin_states()
        now = datetime.now(UTC).isoformat()
        current = states.get(plugin_id, {})

        next_enabled = bool(current.get("enabled", True)) if enabled is None else bool(enabled)
        next_source_type = source_type if source_type is not None else current.get("source_type")
        next_source_ref = source_ref if source_ref is not None else current.get("source_ref")
        next_source_class = (
            _normalize_source_class(source_class)
            if source_class is not None
            else _normalize_source_class(current.get("source_class"))
        )
        next_index_id = index_id if index_id is not None else current.get("index_id")
        next_repo_url = repo_url if repo_url is not None else current.get("repo_url")
        next_tracking_ref = (
            _normalize_tracking_ref(tracking_ref)
            if tracking_ref is not None
            else _normalize_tracking_ref(current.get("tracking_ref"))
        )
        next_plugin_path = (
            _normalize_plugin_path(plugin_path)
            if plugin_path is not None
            else _normalize_plugin_path(current.get("plugin_path"))
        )
        next_auto_update_override = (
            _normalize_auto_update_override(auto_update_override)
            if auto_update_override is not None
            else _normalize_auto_update_override(current.get("auto_update_override"))
        )
        next_update_error = (
            update_error if update_error is not None else current.get("update_error")
        )

        states[plugin_id] = {
            "enabled": next_enabled,
            "installed_at": current.get("installed_at", now),
            "source_type": next_source_type,
            "source_ref": next_source_ref,
            "source_class": next_source_class,
            "index_id": next_index_id,
            "repo_url": next_repo_url,
            "tracking_ref": next_tracking_ref,
            "plugin_path": next_plugin_path,
            "auto_update_override": next_auto_update_override,
            "update_error": next_update_error,
        }
        _save_plugin_states(states)

    def _build_plugin_info(
        self,
        plugin_dir: Path,
        *,
        state: dict[str, Any],
        policy: ProviderPluginPolicy,
    ) -> ProviderPluginInfo:
        installed_at = state.get("installed_at") if isinstance(state, dict) else None
        source_type = state.get("source_type") if isinstance(state, dict) else None
        source_ref = state.get("source_ref") if isinstance(state, dict) else None
        source_class = _normalize_source_class(state.get("source_class"))
        index_id = state.get("index_id") if isinstance(state, dict) else None
        repo_url = state.get("repo_url") if isinstance(state, dict) else None
        tracking_ref = _normalize_tracking_ref(state.get("tracking_ref"))
        normalized_plugin_path = _normalize_plugin_path(state.get("plugin_path"))
        auto_update_override = _normalize_auto_update_override(
            state.get("auto_update_override")
        )
        update_error = state.get("update_error") if isinstance(state, dict) else None

        manifest = self._read_manifest_from_directory(plugin_dir)
        enabled = bool(state.get("enabled", manifest.default_enabled))
        blocked_by_policy = self._is_policy_blocked(source_class=source_class, policy=policy)
        effective_auto_update = (
            _resolve_effective_auto_update(
                override=auto_update_override,
                policy_auto_update_enabled=policy.auto_update_enabled,
            )
            and not blocked_by_policy
        )
        verification = self._verify_plugin_directory(plugin_dir, manifest)

        return ProviderPluginInfo(
            id=manifest.id,
            name=manifest.name,
            version=manifest.version,
            provider=manifest.provider,
            enabled=enabled,
            blocked_by_policy=blocked_by_policy,
            installed_at=installed_at,
            source_type=source_type,
            source_ref=source_ref,
            source_class=source_class,
            index_id=index_id,
            repo_url=repo_url,
            tracking_ref=tracking_ref,
            plugin_path=normalized_plugin_path,
            auto_update_override=auto_update_override,
            effective_auto_update=effective_auto_update,
            description=manifest.description,
            icon=manifest.icon,
            auth_type=manifest.auth_type,
            default_base_url=manifest.default_base_url,
            default_enabled=manifest.default_enabled,
            oauth_variant=manifest.oauth_variant,
            oauth_enterprise_domain=manifest.oauth_enterprise_domain,
            aliases=list(manifest.aliases),
            verification_status=verification.status,
            verification_message=verification.message,
            signing_key_id=verification.signing_key_id,
            update_error=update_error,
        )

    def _read_manifest_from_directory(self, directory: Path) -> ProviderPluginManifest:
        manifest_path = None
        for candidate in ("provider.yaml", "provider.yml"):
            current = directory / candidate
            if current.exists() and current.is_file():
                manifest_path = current
                break

        if manifest_path is None:
            raise ValueError(f"No provider.yaml found in {directory}")

        parsed = yaml.safe_load(manifest_path.read_text())
        if not isinstance(parsed, dict):
            raise ValueError("Provider manifest must be a YAML object")
        return ProviderPluginManifest.parse(parsed, path=manifest_path)

    def _verify_plugin_directory(
        self,
        plugin_dir: Path,
        manifest: ProviderPluginManifest,
    ) -> ProviderPluginVerificationResult:
        if not manifest.signature:
            return ProviderPluginVerificationResult(
                status=_UNSIGNED_TRUST_STATUS,
                message="Plugin is unsigned (no signature metadata found).",
                signing_key_id=None,
            )

        if manifest.signature_algorithm != "ed25519":
            return ProviderPluginVerificationResult(
                status=_INVALID_TRUST_STATUS,
                message=(
                    "Unsupported signature_algorithm "
                    f"'{manifest.signature_algorithm}'. Expected 'ed25519'."
                ),
                signing_key_id=manifest.signing_key_id,
            )

        if not manifest.signing_key_id:
            return ProviderPluginVerificationResult(
                status=_INVALID_TRUST_STATUS,
                message="Plugin signature is missing signing_key_id.",
                signing_key_id=None,
            )

        trusted_keys = _load_trusted_signing_keys()
        signer_key = trusted_keys.get(manifest.signing_key_id)
        if signer_key is None:
            return ProviderPluginVerificationResult(
                status=_UNTRUSTED_TRUST_STATUS,
                message=f"Signer '{manifest.signing_key_id}' is not trusted in local keyring.",
                signing_key_id=manifest.signing_key_id,
            )

        try:
            signature_bytes = _decode_base64(manifest.signature, field_name="signature")
        except ValueError as exc:
            return ProviderPluginVerificationResult(
                status=_INVALID_TRUST_STATUS,
                message=str(exc),
                signing_key_id=manifest.signing_key_id,
            )

        payload = self._build_signature_payload(plugin_dir, manifest.raw)
        try:
            signer_key.verify(signature_bytes, payload)
            return ProviderPluginVerificationResult(
                status=_VERIFIED_TRUST_STATUS,
                message="Verified signature.",
                signing_key_id=manifest.signing_key_id,
            )
        except InvalidSignature:
            return ProviderPluginVerificationResult(
                status=_INVALID_TRUST_STATUS,
                message="Invalid signature for current plugin contents.",
                signing_key_id=manifest.signing_key_id,
            )

    def _build_signature_payload(self, plugin_dir: Path, raw_manifest: dict[str, Any]) -> bytes:
        payload = {
            "manifest": self._sanitize_manifest_for_signature(raw_manifest),
            "files": self._collect_file_hashes(plugin_dir),
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return canonical.encode("utf-8")

    def _sanitize_manifest_for_signature(self, raw_manifest: dict[str, Any]) -> Any:
        filtered = {
            key: value
            for key, value in raw_manifest.items()
            if key not in _SIGNATURE_MANIFEST_FIELDS
        }
        return self._normalize_json_value(filtered)

    def _normalize_json_value(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {k: self._normalize_json_value(v) for k, v in sorted(value.items())}
        if isinstance(value, list):
            return [self._normalize_json_value(item) for item in value]
        return value

    def _collect_file_hashes(self, plugin_dir: Path) -> list[dict[str, str]]:
        digests: list[dict[str, str]] = []
        for file_path in sorted(plugin_dir.rglob("*")):
            if not file_path.is_file():
                continue

            rel_parts = file_path.relative_to(plugin_dir).parts
            if any(part.startswith(".") for part in rel_parts):
                continue
            if "__pycache__" in rel_parts or file_path.suffix == ".pyc":
                continue

            rel_path = PurePosixPath(*rel_parts).as_posix()
            if rel_path in {"provider.yaml", "provider.yml"}:
                continue

            sha256 = hashlib.sha256(file_path.read_bytes()).hexdigest()
            digests.append({"path": rel_path, "sha256": sha256})
        return digests

    def _find_and_parse_manifest(self, zf: zipfile.ZipFile) -> dict[str, Any]:
        candidates = [
            "provider.yaml",
            "provider.yml",
        ]
        names = zf.namelist()

        for name in candidates:
            if name in names:
                parsed = yaml.safe_load(zf.read(name).decode("utf-8"))
                if isinstance(parsed, dict):
                    return parsed

        for name in names:
            if name.count("/") == 1 and (
                name.endswith("/provider.yaml") or name.endswith("/provider.yml")
            ):
                parsed = yaml.safe_load(zf.read(name).decode("utf-8"))
                if isinstance(parsed, dict):
                    return parsed

        raise ValueError("No provider.yaml found in ZIP file")

    def _detect_single_root_prefix(self, zf: zipfile.ZipFile) -> str | None:
        roots: set[str] = set()
        files: list[str] = []
        for info in zf.infolist():
            if info.is_dir():
                continue
            path = info.filename.strip("/")
            if not path:
                continue
            files.append(path)
            parts = path.split("/")
            if len(parts) > 1:
                roots.add(parts[0])
            else:
                return None

        if len(roots) == 1 and files:
            return f"{next(iter(roots))}/"
        return None

    def _normalize_zip_path(self, path: str, root_prefix: str | None) -> str | None:
        normalized = path.replace("\\", "/").strip("/")
        if root_prefix and normalized.startswith(root_prefix):
            normalized = normalized[len(root_prefix) :]
        if not normalized:
            return None

        posix_path = PurePosixPath(normalized)
        if posix_path.is_absolute() or ".." in posix_path.parts:
            raise ValueError(f"Invalid path in provider plugin archive: {path}")
        if any(part.startswith(".") for part in posix_path.parts):
            return None

        return str(posix_path)


_provider_plugin_manager: ProviderPluginManager | None = None


def get_provider_plugin_manager() -> ProviderPluginManager:
    global _provider_plugin_manager
    if _provider_plugin_manager is None:
        _provider_plugin_manager = ProviderPluginManager()
    return _provider_plugin_manager
