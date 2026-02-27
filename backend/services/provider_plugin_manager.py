from __future__ import annotations

import io
import json
import logging
import re
import shutil
import zipfile
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from .. import db
from ..config import get_db_directory

logger = logging.getLogger(__name__)

PROVIDER_PLUGIN_STATE_KEY = "provider_plugin_states"
SUPPORTED_PROVIDER_PLUGIN_MANIFEST_VERSIONS = {"1"}
MAX_PROVIDER_PLUGIN_SIZE_BYTES = 20 * 1024 * 1024
_PROVIDER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


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
            raise ValueError(
                "Provider plugin id must match ^[a-z0-9][a-z0-9_-]*$"
            )

        name = str(raw.get("name") or "").strip()
        if not name:
            raise ValueError("Provider plugin manifest missing required field: name")

        version = str(raw.get("version") or "").strip()
        if not version:
            raise ValueError("Provider plugin manifest missing required field: version")

        provider = str(raw.get("provider") or plugin_id).strip().lower().replace("-", "_")
        if not _PROVIDER_ID_RE.match(provider):
            raise ValueError(
                "Provider id must match ^[a-z0-9][a-z0-9_]*$"
            )

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
                raise ValueError(
                    "Provider plugin entrypoint must be in format 'module:function'"
                )

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
                raise ValueError(
                    "oauth_variant must be one of: panel, compact, inline-code, device"
                )

        default_enabled = raw.get("default_enabled", True)
        if not isinstance(default_enabled, bool):
            raise ValueError("default_enabled must be a boolean")

        default_base_url = raw.get("default_base_url")
        if default_base_url is not None:
            default_base_url = str(default_base_url).strip() or None

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
            path=path,
            raw=dict(raw),
        )


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
    error: str | None = None


def get_provider_plugins_directory() -> Path:
    plugins_dir = get_db_directory() / "provider_plugins"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    return plugins_dir


def get_provider_plugin_directory(plugin_id: str) -> Path:
    return get_provider_plugins_directory() / plugin_id


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
            installed_at = state.get("installed_at") if isinstance(state, dict) else None
            source_type = state.get("source_type") if isinstance(state, dict) else None
            source_ref = state.get("source_ref") if isinstance(state, dict) else None

            try:
                manifest = self._read_manifest_from_directory(plugin_dir)
                enabled = bool(state.get("enabled", manifest.default_enabled))
                infos.append(
                    ProviderPluginInfo(
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
                    )
                )
            except Exception as exc:
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
                        error=str(exc),
                    )
                )

        return sorted(infos, key=lambda item: item.name.lower())

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
        logger.info("Installed provider plugin '%s'", manifest.id)
        return manifest.id

    def import_from_directory(self, directory: Path) -> str:
        manifest = self._read_manifest_from_directory(directory)

        target_dir = get_provider_plugin_directory(manifest.id)
        if target_dir.exists():
            raise ValueError(f"Provider plugin '{manifest.id}' is already installed")

        shutil.copytree(directory, target_dir)
        self._set_state(
            manifest.id,
            enabled=manifest.default_enabled,
            source_type="local",
            source_ref=str(directory),
        )
        logger.info("Installed provider plugin '%s' from directory", manifest.id)
        return manifest.id

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
