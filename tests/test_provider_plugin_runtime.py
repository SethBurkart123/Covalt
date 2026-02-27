from __future__ import annotations

import importlib
import zipfile
from pathlib import Path

from backend.services import provider_plugin_manager as ppm


def _write_code_plugin(source_dir: Path) -> None:
    (source_dir / "provider.yaml").write_text(
        "\n".join(
            [
                "manifest_version: '1'",
                "id: runtime-code-plugin",
                "name: Runtime Code Plugin",
                "version: 0.2.0",
                "provider: runtime_code_provider",
                "entrypoint: plugin:create_provider",
                "aliases:",
                "  - runtime-code",
                "description: Runtime code provider",
                "icon: openai",
                "default_enabled: true",
            ]
        )
    )
    (source_dir / "plugin.py").write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "def create_provider(provider_id, **_kwargs):",
                "    async def fetch_models():",
                "        return [{'id': 'runtime-model', 'name': 'Runtime Model'}]",
                "",
                "    def get_model(model_id, provider_options=None):",
                "        return {'provider': provider_id, 'model': model_id}",
                "",
                "    async def test_connection():",
                "        return True, None",
                "",
                "    return {",
                "        'get_model': get_model,",
                "        'fetch_models': fetch_models,",
                "        'test_connection': test_connection,",
                "    }",
            ]
        )
    )


def _make_zip_plugin(source_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in source_dir.rglob("*"):
            if file_path.is_dir():
                continue
            zf.write(file_path, arcname=f"runtime-code-plugin/{file_path.name}")


def test_provider_registry_loads_code_plugin_from_directory(monkeypatch, tmp_path: Path) -> None:
    installed_root = tmp_path / "installed"
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}

    monkeypatch.setattr(ppm, "_provider_plugin_manager", None)
    monkeypatch.setattr(ppm, "_load_plugin_states", lambda: dict(state_store))

    def _save(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(ppm, "_save_plugin_states", _save)
    monkeypatch.setattr(ppm, "get_provider_plugins_directory", lambda: installed_root)
    monkeypatch.setattr(
        ppm,
        "get_provider_plugin_directory",
        lambda plugin_id: installed_root / plugin_id,
    )

    manager = ppm.ProviderPluginManager()
    source_dir = tmp_path / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)
    manager.import_from_directory(source_dir)

    providers_module = importlib.import_module("backend.providers")
    providers_module.reload_provider_registry()

    assert "runtime_code_provider" in providers_module.PROVIDERS
    assert providers_module.ALIASES["runtime_code"] == "runtime_code_provider"


def test_provider_plugin_import_from_zip(monkeypatch, tmp_path: Path) -> None:
    installed_root = tmp_path / "installed"
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}

    monkeypatch.setattr(ppm, "_provider_plugin_manager", None)
    monkeypatch.setattr(ppm, "_load_plugin_states", lambda: dict(state_store))

    def _save(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(ppm, "_save_plugin_states", _save)
    monkeypatch.setattr(ppm, "get_provider_plugins_directory", lambda: installed_root)
    monkeypatch.setattr(
        ppm,
        "get_provider_plugin_directory",
        lambda plugin_id: installed_root / plugin_id,
    )

    manager = ppm.ProviderPluginManager()
    source_dir = tmp_path / "zip-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)

    zip_path = tmp_path / "runtime-plugin.zip"
    _make_zip_plugin(source_dir, zip_path)

    plugin_id = manager.import_from_zip(zip_path)
    assert plugin_id == "runtime-code-plugin"
    assert (installed_root / "runtime-code-plugin" / "provider.yaml").exists()
