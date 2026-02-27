from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import re
import shutil
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

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
_SIGNATURE_MANIFEST_FIELDS = {"signature", "signing_key_id", "signature_algorithm"}

_VERIFIED_TRUST_STATUS = "verified"
_UNSIGNED_TRUST_STATUS = "unsigned"
_UNTRUSTED_TRUST_STATUS = "untrusted"
_INVALID_TRUST_STATUS = "invalid"

_PROVIDER_PLUGIN_TRUSTED_KEYS_RELATIVE_PATH = Path("providers") / "provider_plugin_trusted_keys.json"

_trusted_signing_keys_cache: dict[str, Ed25519Verifier] | None = None
_trusted_signing_keys_mtime: float | None = None


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
    installed_at: str | None
    source_type: str | None
    source_ref: str | None
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

    def list_plugins(self) -> list[ProviderPluginInfo]:
        states = _load_plugin_states()
        infos: list[ProviderPluginInfo] = []

        for plugin_dir in sorted(self.plugins_dir.iterdir(), key=lambda p: p.name.lower()):
            if not plugin_dir.is_dir():
                continue

            state = states.get(plugin_dir.name, {})
            try:
                infos.append(self._build_plugin_info(plugin_dir, state=state))
            except Exception as exc:
                installed_at = state.get("installed_at") if isinstance(state, dict) else None
                source_type = state.get("source_type") if isinstance(state, dict) else None
                source_ref = state.get("source_ref") if isinstance(state, dict) else None
                infos.append(
                    ProviderPluginInfo(
                        id=plugin_dir.name,
                        name=plugin_dir.name,
                        version="unknown",
                        provider=plugin_dir.name,
                        enabled=bool(state.get("enabled", False)),
                        installed_at=installed_at,
                        source_type=source_type,
                        source_ref=source_ref,
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
        return self._build_plugin_info(plugin_dir, state=state)

    def get_enabled_manifests(self) -> list[ProviderPluginManifest]:
        states = _load_plugin_states()
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
            if enabled:
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

    def _set_state(
        self,
        plugin_id: str,
        *,
        enabled: bool,
        source_type: str | None = None,
        source_ref: str | None = None,
    ) -> None:
        states = _load_plugin_states()
        now = datetime.now(UTC).isoformat()
        current = states.get(plugin_id, {})
        states[plugin_id] = {
            "enabled": enabled,
            "installed_at": current.get("installed_at", now),
            "source_type": source_type or current.get("source_type"),
            "source_ref": source_ref or current.get("source_ref"),
        }
        _save_plugin_states(states)

    def _build_plugin_info(
        self,
        plugin_dir: Path,
        *,
        state: dict[str, Any],
    ) -> ProviderPluginInfo:
        installed_at = state.get("installed_at") if isinstance(state, dict) else None
        source_type = state.get("source_type") if isinstance(state, dict) else None
        source_ref = state.get("source_ref") if isinstance(state, dict) else None

        manifest = self._read_manifest_from_directory(plugin_dir)
        enabled = bool(state.get("enabled", manifest.default_enabled))
        verification = self._verify_plugin_directory(plugin_dir, manifest)

        return ProviderPluginInfo(
            id=manifest.id,
            name=manifest.name,
            version=manifest.version,
            provider=manifest.provider,
            enabled=enabled,
            installed_at=installed_at,
            source_type=source_type,
            source_ref=source_ref,
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
