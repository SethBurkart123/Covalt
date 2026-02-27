from __future__ import annotations

from pathlib import Path

from backend.services import provider_plugin_manager as ppm


def _write_code_plugin(source_dir: Path) -> None:
    (source_dir / "provider.yaml").write_text(
        "\n".join(
            [
                "manifest_version: '1'",
                "id: community-echo",
                "name: Community Echo",
                "version: 0.1.0",
                "provider: community_echo",
                "entrypoint: plugin:create_provider",
                "aliases:",
                "  - community-echo",
                "description: Community Echo provider",
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
                "        return [{'id': 'echo-model', 'name': 'Echo Model'}]",
                "",
                "    def get_model(model_id, provider_options=None):",
                "        return {'provider': provider_id, 'model': model_id, 'options': provider_options or {}}",
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


def test_provider_plugin_manager_lifecycle(monkeypatch, tmp_path: Path) -> None:
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

    source_dir = tmp_path / "source-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)

    plugin_id = manager.import_from_directory(source_dir)
    assert plugin_id == "community-echo"

    manifest = manager.get_manifest(plugin_id)
    assert manifest is not None
    assert manifest.provider == "community_echo"
    assert manifest.entrypoint == "plugin:create_provider"

    plugins = manager.list_plugins()
    assert len(plugins) == 1
    assert plugins[0].id == "community-echo"
    assert plugins[0].enabled is True

    assert manager.enable_plugin("community-echo", False) is True
    assert manager.get_enabled_manifests() == []

    assert manager.enable_plugin("community-echo", True) is True
    assert [m.id for m in manager.get_enabled_manifests()] == ["community-echo"]

    assert manager.uninstall("community-echo") is True
    assert manager.list_plugins() == []
