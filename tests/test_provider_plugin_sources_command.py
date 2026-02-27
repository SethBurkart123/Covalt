from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import backend.commands.provider_plugins as provider_plugins


@pytest.mark.asyncio
async def test_list_provider_plugin_sources_marks_installed(monkeypatch) -> None:
    fake_manager = SimpleNamespace(
        list_plugins=lambda: [SimpleNamespace(id="sample_openai_adapter")],
    )
    monkeypatch.setattr(provider_plugins, "get_provider_plugin_manager", lambda: fake_manager)

    response = await provider_plugins.list_provider_plugin_sources()

    by_id = {item.id: item for item in response.sources}
    assert by_id["sample-openai-adapter"].installed is True
    assert by_id["sample-code-provider"].installed is False


@pytest.mark.asyncio
async def test_install_provider_plugin_source_uses_source_path(monkeypatch, tmp_path: Path) -> None:
    source_dir = tmp_path / "source-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        provider_plugins,
        "_PROVIDER_PLUGIN_SOURCES",
        (
            {
                "id": "tmp-source",
                "plugin_id": "tmp_plugin",
                "name": "Tmp Plugin",
                "version": "0.1.0",
                "provider": "tmp_provider",
                "description": "tmp",
                "icon": "openai",
                "path": str(source_dir),
            },
        ),
    )

    captured: dict[str, object] = {}

    class _FakeManager:
        def import_from_directory(self, directory: Path) -> str:
            captured["import_dir"] = directory
            return "tmp_plugin"

        def get_manifest(self, plugin_id: str):
            if plugin_id != "tmp_plugin":
                return None
            return SimpleNamespace(
                id="tmp_plugin",
                provider="tmp_provider",
                name="Tmp Plugin",
                version="0.1.0",
                default_enabled=False,
                default_base_url="https://api.example.com/v1",
            )

        def enable_plugin(self, plugin_id: str, enabled: bool) -> bool:
            captured["plugin_enabled"] = {"id": plugin_id, "enabled": enabled}
            return True

    monkeypatch.setattr(provider_plugins, "get_provider_plugin_manager", lambda: _FakeManager())
    monkeypatch.setattr(provider_plugins, "reload_provider_registry", lambda: None)

    def _capture_settings(provider: str, *, enabled: bool, base_url: str | None) -> None:
        captured["settings"] = {
            "provider": provider,
            "enabled": enabled,
            "base_url": base_url,
        }

    monkeypatch.setattr(provider_plugins, "_ensure_provider_settings_initialized", _capture_settings)

    response = await provider_plugins.install_provider_plugin_source(
        provider_plugins.InstallProviderPluginSourceInput(id="tmp-source")
    )

    assert response.id == "tmp_plugin"
    assert captured["import_dir"] == source_dir
    assert captured["plugin_enabled"] == {"id": "tmp_plugin", "enabled": True}
    assert captured["settings"] == {
        "provider": "tmp_provider",
        "enabled": False,
        "base_url": "https://api.example.com/v1",
    }
