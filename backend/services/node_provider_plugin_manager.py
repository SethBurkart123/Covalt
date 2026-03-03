
from __future__ import annotations

import json
import logging
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from .. import db
from ..config import get_db_directory
from . import plugin_install_utils

logger = logging.getLogger(__name__)

NODE_PROVIDER_PLUGIN_STATE_KEY = 'node_provider_plugin_states'
SUPPORTED_MANIFEST_VERSIONS = {'1'}
MAX_NODE_PROVIDER_PLUGIN_SIZE_BYTES = 20 * 1024 * 1024
_PLUGIN_ID_RE = re.compile(r'^[a-z0-9][a-z0-9_-]*$')


@dataclass(frozen=True)
class NodeProviderPluginManifest:
    id: str
    name: str
    version: str
    runtime_kind: str
    runtime_entrypoint: str
    definitions_source: str
    definitions_file: str | None
    path: Path
    raw: dict[str, Any]

    @classmethod
    def parse(cls, raw: dict[str, Any], *, path: Path) -> NodeProviderPluginManifest:
        manifest_version = str(raw.get('manifest_version', '1')).strip()
        if manifest_version not in SUPPORTED_MANIFEST_VERSIONS:
            raise ValueError(f'Unsupported node provider manifest version: {manifest_version}')

        plugin_id = str(raw.get('id') or '').strip().lower()
        if not plugin_id:
            raise ValueError('Node provider manifest missing required field: id')
        if not _PLUGIN_ID_RE.match(plugin_id):
            raise ValueError('Node provider plugin id must match ^[a-z0-9][a-z0-9_-]*$')

        name = str(raw.get('name') or '').strip()
        if not name:
            raise ValueError('Node provider manifest missing required field: name')

        version = str(raw.get('version') or '').strip()
        if not version:
            raise ValueError('Node provider manifest missing required field: version')

        runtime = raw.get('runtime')
        if not isinstance(runtime, dict):
            raise ValueError('Node provider manifest missing required object: runtime')

        runtime_kind = str(runtime.get('kind') or '').strip().lower()
        if runtime_kind != 'bun':
            raise ValueError("Node provider runtime.kind must be 'bun'")

        runtime_entrypoint = str(runtime.get('entrypoint') or '').strip()
        if not runtime_entrypoint:
            raise ValueError('Node provider runtime.entrypoint is required')
        _validate_relative_file_path(runtime_entrypoint, field_name='runtime.entrypoint')

        definitions = raw.get('definitions') or {}
        if not isinstance(definitions, dict):
            raise ValueError('Node provider definitions must be an object')

        definitions_source = str(definitions.get('source') or 'runtime').strip().lower()
        if definitions_source not in {'runtime', 'file'}:
            raise ValueError("Node provider definitions.source must be 'runtime' or 'file'")

        definitions_file: str | None = None
        if definitions_source == 'file':
            definitions_file = str(definitions.get('file') or '').strip()
            if not definitions_file:
                raise ValueError("definitions.file is required when definitions.source='file'")
            _validate_relative_file_path(definitions_file, field_name='definitions.file')

        return cls(
            id=plugin_id,
            name=name,
            version=version,
            runtime_kind=runtime_kind,
            runtime_entrypoint=runtime_entrypoint,
            definitions_source=definitions_source,
            definitions_file=definitions_file,
            path=path,
            raw=dict(raw),
        )


@dataclass(frozen=True)
class NodeProviderPluginInfo:
    id: str
    name: str
    version: str
    enabled: bool
    installed_at: str | None
    source_type: str | None
    source_ref: str | None
    repo_url: str | None
    tracking_ref: str | None
    plugin_path: str | None
    error: str | None = None


def get_node_provider_plugins_directory() -> Path:
    plugins_dir = get_db_directory() / 'node_provider_plugins'
    plugins_dir.mkdir(parents=True, exist_ok=True)
    return plugins_dir


def get_node_provider_plugin_directory(plugin_id: str) -> Path:
    return get_node_provider_plugins_directory() / plugin_id


def _normalize_plugin_path(value: str | None) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().strip('/')
    if not raw:
        return None

    posix = PurePosixPath(raw)
    if posix.is_absolute() or '..' in posix.parts:
        raise ValueError('pluginPath must be a relative path without traversal')
    return posix.as_posix()


def _validate_relative_file_path(value: str, *, field_name: str) -> None:
    raw = value.strip()
    if not raw:
        raise ValueError(f'{field_name} cannot be empty')
    p = PurePosixPath(raw)
    if p.is_absolute() or '..' in p.parts:
        raise ValueError(f'{field_name} must be a relative path without traversal')


def _read_manifest_from_directory(source_dir: Path) -> NodeProviderPluginManifest:
    manifest_path = source_dir / 'node-provider.yaml'
    if not manifest_path.exists():
        raise ValueError('Node provider plugin is missing node-provider.yaml')

    raw_manifest = yaml.safe_load(manifest_path.read_text())
    if not isinstance(raw_manifest, dict):
        raise ValueError('Node provider manifest must be a YAML object')

    manifest = NodeProviderPluginManifest.parse(raw_manifest, path=manifest_path)

    runtime_entry = source_dir / manifest.runtime_entrypoint
    if not runtime_entry.exists() or not runtime_entry.is_file():
        raise ValueError(
            f"Node provider runtime entrypoint not found: {manifest.runtime_entrypoint}"
        )

    if manifest.definitions_source == 'file':
        assert manifest.definitions_file is not None
        definitions_file = source_dir / manifest.definitions_file
        if not definitions_file.exists() or not definitions_file.is_file():
            raise ValueError(
                f"Node provider definitions file not found: {manifest.definitions_file}"
            )

    return manifest


def _load_plugin_states() -> dict[str, dict[str, Any]]:
    with db.db_session() as sess:
        raw = db.get_user_setting(sess, NODE_PROVIDER_PLUGIN_STATE_KEY)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}

    cleaned: dict[str, dict[str, Any]] = {}
    for plugin_id, state in parsed.items():
        if not isinstance(plugin_id, str) or not isinstance(state, dict):
            continue
        cleaned[plugin_id] = dict(state)
    return cleaned


def _save_plugin_states(states: dict[str, dict[str, Any]]) -> None:
    with db.db_session() as sess:
        db.set_user_setting(sess, NODE_PROVIDER_PLUGIN_STATE_KEY, json.dumps(states))


class NodeProviderPluginManager:
    def __init__(self) -> None:
        self._states = _load_plugin_states()

    def _persist_states(self) -> None:
        _save_plugin_states(self._states)

    def _state_for(self, plugin_id: str) -> dict[str, Any]:
        return dict(self._states.get(plugin_id, {}))

    def _set_state(self, plugin_id: str, **updates: Any) -> None:
        state = self._state_for(plugin_id)
        state.update(updates)
        self._states[plugin_id] = state
        self._persist_states()

    def get_manifest(self, plugin_id: str) -> NodeProviderPluginManifest | None:
        plugin_dir = get_node_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return None
        try:
            return _read_manifest_from_directory(plugin_dir)
        except Exception:
            return None

    def list_plugins(self) -> list[NodeProviderPluginInfo]:
        root = get_node_provider_plugins_directory()
        items: list[NodeProviderPluginInfo] = []

        for plugin_dir in sorted(root.iterdir(), key=lambda p: p.name.lower()):
            if not plugin_dir.is_dir():
                continue

            plugin_id = plugin_dir.name
            state = self._state_for(plugin_id)
            enabled = bool(state.get('enabled', True))

            try:
                manifest = _read_manifest_from_directory(plugin_dir)
                info = NodeProviderPluginInfo(
                    id=manifest.id,
                    name=manifest.name,
                    version=manifest.version,
                    enabled=enabled,
                    installed_at=_to_iso(state.get('installed_at')),
                    source_type=_to_str_or_none(state.get('source_type')),
                    source_ref=_to_str_or_none(state.get('source_ref')),
                    repo_url=_to_str_or_none(state.get('repo_url')),
                    tracking_ref=_to_str_or_none(state.get('tracking_ref')),
                    plugin_path=_to_str_or_none(state.get('plugin_path')),
                )
            except Exception as exc:
                info = NodeProviderPluginInfo(
                    id=plugin_id,
                    name=plugin_id,
                    version='unknown',
                    enabled=False,
                    installed_at=_to_iso(state.get('installed_at')),
                    source_type=_to_str_or_none(state.get('source_type')),
                    source_ref=_to_str_or_none(state.get('source_ref')),
                    repo_url=_to_str_or_none(state.get('repo_url')),
                    tracking_ref=_to_str_or_none(state.get('tracking_ref')),
                    plugin_path=_to_str_or_none(state.get('plugin_path')),
                    error=str(exc),
                )
            items.append(info)

        return items

    def enable_plugin(self, plugin_id: str, enabled: bool) -> bool:
        if self.get_manifest(plugin_id) is None:
            return False
        self._set_state(plugin_id, enabled=bool(enabled))
        return True

    def uninstall(self, plugin_id: str) -> bool:
        plugin_dir = get_node_provider_plugin_directory(plugin_id)
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return False
        shutil.rmtree(plugin_dir)
        self._states.pop(plugin_id, None)
        self._persist_states()
        return True

    def get_enabled_manifests(self) -> list[NodeProviderPluginManifest]:
        manifests: list[NodeProviderPluginManifest] = []
        for info in self.list_plugins():
            if not info.enabled:
                continue
            manifest = self.get_manifest(info.id)
            if manifest is not None:
                manifests.append(manifest)
        return manifests

    def import_from_zip(
        self,
        *,
        zip_data: bytes,
        source_type: str = 'zip',
        source_ref: str | None = None,
        repo_url: str | None = None,
        tracking_ref: str | None = None,
        plugin_path: str | None = None,
    ) -> str:
        if len(zip_data) > MAX_NODE_PROVIDER_PLUGIN_SIZE_BYTES:
            raise ValueError('Node provider plugin archive exceeds 20MB limit')

        with tempfile.TemporaryDirectory(prefix='node-provider-plugin-zip-') as tmp:
            tmp_root = Path(tmp)
            archive_path = tmp_root / 'plugin.zip'
            archive_path.write_bytes(zip_data)

            extract_dir = tmp_root / 'extract'
            extract_dir.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(archive_path, 'r') as zf:
                self._safe_extract(zf, extract_dir)

            candidate_dirs = [p for p in extract_dir.iterdir() if p.is_dir()]
            if len(candidate_dirs) == 1 and not (candidate_dirs[0] / 'node-provider.yaml').exists():
                source_dir = candidate_dirs[0]
            else:
                source_dir = extract_dir

            return self.import_from_directory(
                source_dir,
                source_type=source_type,
                source_ref=source_ref,
                repo_url=repo_url,
                tracking_ref=tracking_ref,
                plugin_path=plugin_path,
            )

    def _safe_extract(self, zf: zipfile.ZipFile, target_dir: Path) -> None:
        for member in zf.infolist():
            member_path = PurePosixPath(member.filename)
            if member_path.is_absolute() or '..' in member_path.parts:
                raise ValueError('Archive contains invalid path traversal entries')
        zf.extractall(target_dir)

    def import_from_directory(
        self,
        directory: Path,
        *,
        source_type: str = 'local',
        source_ref: str | None = None,
        repo_url: str | None = None,
        tracking_ref: str | None = None,
        plugin_path: str | None = None,
    ) -> str:
        source_dir = directory.resolve()
        if not source_dir.exists() or not source_dir.is_dir():
            raise ValueError(f'Node provider plugin directory not found: {directory}')

        manifest = _read_manifest_from_directory(source_dir)
        plugin_id = manifest.id

        dest_dir = get_node_provider_plugin_directory(plugin_id)
        if dest_dir.exists():
            shutil.rmtree(dest_dir)
        shutil.copytree(source_dir, dest_dir)

        self._set_state(
            plugin_id,
            enabled=True,
            installed_at=datetime.now(UTC).isoformat(),
            source_type=source_type,
            source_ref=source_ref,
            repo_url=repo_url,
            tracking_ref=tracking_ref,
            plugin_path=plugin_path,
        )
        return plugin_id

    def install_from_repo(
        self,
        *,
        repo_url: str,
        ref: str | None = 'main',
        plugin_path: str | None = None,
        source_type: str = 'repo',
        source_ref: str | None = None,
    ) -> str:
        normalized_repo = plugin_install_utils.normalize_repo_url(repo_url, require_netloc=True)
        tracking_ref = (ref or 'main').strip() or 'main'
        normalized_plugin_path = _normalize_plugin_path(plugin_path)

        archive_bytes = plugin_install_utils.download_github_archive(
            normalized_repo,
            tracking_ref,
            require_netloc=True,
        )
        with tempfile.TemporaryDirectory(prefix='node-provider-plugin-repo-') as tmp:
            tmp_dir = Path(tmp)
            archive_path = tmp_dir / 'repo.zip'
            archive_path.write_bytes(archive_bytes)

            with zipfile.ZipFile(archive_path, 'r') as zf:
                zf.extractall(tmp_dir / 'repo')

            extracted_roots = [path for path in (tmp_dir / 'repo').iterdir() if path.is_dir()]
            if not extracted_roots:
                raise ValueError('Repository archive did not contain a valid root directory')
            repo_root = extracted_roots[0]

            install_root = repo_root / normalized_plugin_path if normalized_plugin_path else repo_root
            if not install_root.exists() or not install_root.is_dir():
                raise ValueError('pluginPath not found in repository archive')

            return self.import_from_directory(
                install_root,
                source_type=source_type,
                source_ref=source_ref or normalized_repo,
                repo_url=normalized_repo,
                tracking_ref=tracking_ref,
                plugin_path=normalized_plugin_path,
            )


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    return raw or None


def _to_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    return raw or None


_node_provider_plugin_manager: NodeProviderPluginManager | None = None


def get_node_provider_plugin_manager() -> NodeProviderPluginManager:
    global _node_provider_plugin_manager
    if _node_provider_plugin_manager is None:
        _node_provider_plugin_manager = NodeProviderPluginManager()
    return _node_provider_plugin_manager
