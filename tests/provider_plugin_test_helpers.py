from __future__ import annotations

import json
import zipfile
from collections.abc import Sequence
from pathlib import Path

from backend.services.plugins import provider_plugin_manager as ppm


def write_provider_code_plugin(
    source_dir: Path,
    *,
    plugin_id: str,
    provider: str,
    name: str | None = None,
    version: str = "0.1.0",
    aliases: Sequence[str] | None = None,
    description: str = "test plugin",
    icon: str = "openai",
    default_enabled: bool = True,
    signature: str | None = None,
    signing_key_id: str | None = None,
    signature_algorithm: str | None = None,
    model_id: str = "x",
    model_name: str = "X",
) -> None:
    plugin_name = name or plugin_id
    manifest_lines = [
        "manifest_version: '1'",
        f"id: {plugin_id}",
        f"name: {plugin_name}",
        f"version: {version}",
        f"provider: {provider}",
        "entrypoint: plugin:create_provider",
    ]

    alias_list = [alias.strip() for alias in aliases or [] if alias.strip()]
    if alias_list:
        manifest_lines.append("aliases:")
        manifest_lines.extend([f"  - {alias}" for alias in alias_list])

    manifest_lines.extend(
        [
            f"description: {description}",
            f"icon: {icon}",
            f"default_enabled: {str(default_enabled).lower()}",
        ]
    )

    if signature is not None:
        manifest_lines.append(f"signature: {signature}")
    if signing_key_id is not None:
        manifest_lines.append(f"signing_key_id: {signing_key_id}")
    if signature_algorithm is not None:
        manifest_lines.append(f"signature_algorithm: {signature_algorithm}")

    (source_dir / "provider.yaml").write_text("\n".join(manifest_lines))
    (source_dir / "plugin.py").write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "def create_provider(provider_id, **_kwargs):",
                "    async def fetch_models():",
                f"        return [{{'id': '{model_id}', 'name': '{model_name}'}}]",
                "",
                "    def get_model(model_id, provider_options=None):",
                "        return {'provider': provider_id, 'model': model_id, 'options': provider_options or {}}",
                "",
                "    async def test_connection():",
                "        return True, None",
                "",
                "    return {'get_model': get_model, 'fetch_models': fetch_models, 'test_connection': test_connection}",
            ]
        )
    )


def write_zip_from_directory(source_dir: Path, out_zip: Path, *, root_dir_name: str | None = None) -> None:
    root_dir = root_dir_name or source_dir.name
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in source_dir.rglob("*"):
            if file_path.is_dir():
                continue
            relative_path = file_path.relative_to(source_dir).as_posix()
            zf.write(file_path, arcname=f"{root_dir}/{relative_path}")


def setup_provider_plugin_manager(
    monkeypatch,
    tmp_path: Path,
    *,
    include_policy_storage: bool = False,
) -> ppm.ProviderPluginManager:
    installed_root = tmp_path / "installed"
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}

    monkeypatch.setattr(ppm, "_provider_plugin_manager", None)
    monkeypatch.setattr(ppm, "_load_plugin_states", lambda: dict(state_store))

    def _save_states(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(ppm, "_save_plugin_states", _save_states)

    if include_policy_storage:
        policy_store: dict[str, object] = {}
        index_store: list[dict[str, object]] = []

        def _get_user_setting(_sess, key: str):
            if key == "provider_plugin_policy":
                return json.dumps(policy_store) if policy_store else None
            if key == "provider_plugin_indexes":
                return json.dumps(index_store)
            return None

        def _set_user_setting(_sess, key: str, value: str):
            if key == "provider_plugin_policy":
                payload = json.loads(value)
                policy_store.clear()
                policy_store.update(payload)
                return
            if key == "provider_plugin_indexes":
                payload = json.loads(value)
                index_store.clear()
                index_store.extend(payload)

        monkeypatch.setattr(ppm.db, "get_user_setting", _get_user_setting)
        monkeypatch.setattr(ppm.db, "set_user_setting", _set_user_setting)

    monkeypatch.setattr(ppm, "get_provider_plugins_directory", lambda: installed_root)
    monkeypatch.setattr(ppm, "get_provider_plugin_directory", lambda plugin_id: installed_root / plugin_id)

    return ppm.ProviderPluginManager()
