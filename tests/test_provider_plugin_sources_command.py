from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import backend.commands.provider_plugins as provider_plugins


@pytest.mark.asyncio
async def test_list_provider_plugin_sources_marks_installed_and_policy_flags(monkeypatch) -> None:
    class _FakeManager:
        def list_plugins(self):
            return [SimpleNamespace(id="sample_openai_adapter")]

        def list_sources(self):
            return [
                SimpleNamespace(
                    id="official-source",
                    plugin_id="sample_openai_adapter",
                    name="Official",
                    version="1.0.0",
                    provider="sample_openai_adapter",
                    description="official",
                    icon="openai",
                    source_class="official",
                    index_id="official-index",
                    index_name="Official",
                    source_url="builtin://official",
                    repo_url=None,
                    tracking_ref=None,
                    plugin_path="examples/provider-plugins/sample-openai-adapter",
                ),
                SimpleNamespace(
                    id="community-source",
                    plugin_id="community_plugin",
                    name="Community",
                    version="1.0.0",
                    provider="community_provider",
                    description="community",
                    icon="openai",
                    source_class="community",
                    index_id="community-index",
                    index_name="Community",
                    source_url="https://example.com/index.json",
                    repo_url="https://github.com/acme/plugin",
                    tracking_ref="main",
                    plugin_path=None,
                ),
            ]

        def is_install_blocked_by_policy(self, source_class: str) -> bool:
            return source_class == "community"

    monkeypatch.setattr(provider_plugins, "get_provider_plugin_manager", lambda: _FakeManager())

    response = await provider_plugins.list_provider_plugin_sources()

    by_id = {item.id: item for item in response.sources}
    assert by_id["official-source"].installed is True
    assert by_id["official-source"].blockedByPolicy is False

    assert by_id["community-source"].installed is False
    assert by_id["community-source"].blockedByPolicy is True


@pytest.mark.asyncio
async def test_install_provider_plugin_source_uses_manager_install(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeManager:
        def get_source(self, source_id: str):
            if source_id != "tmp-source":
                return None
            return SimpleNamespace(source_class="official")

        def install_source(self, source_id: str) -> str:
            captured["installed_source_id"] = source_id
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

        def get_plugin_info(self, plugin_id: str):
            if plugin_id != "tmp_plugin":
                return None
            return SimpleNamespace(
                verification_status="unsigned",
                verification_message="Plugin is unsigned (no signature metadata found).",
                signing_key_id=None,
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
    assert response.verificationStatus == "unsigned"
    assert response.verificationMessage is not None
    assert captured["installed_source_id"] == "tmp-source"
    assert captured["plugin_enabled"] == {"id": "tmp_plugin", "enabled": True}
    assert captured["settings"] == {
        "provider": "tmp_provider",
        "enabled": False,
        "base_url": "https://api.example.com/v1",
    }


@pytest.mark.asyncio
async def test_install_provider_plugin_from_repo_calls_manager(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeManager:
        def is_install_blocked_by_policy(self, source_class: str) -> bool:
            return False

        def install_from_repo(self, **kwargs):
            captured["install_kwargs"] = kwargs
            return "repo_plugin"

        def get_manifest(self, plugin_id: str):
            return SimpleNamespace(
                id=plugin_id,
                provider="repo_provider",
                name="Repo Plugin",
                version="0.1.0",
                default_enabled=False,
                default_base_url=None,
            )

        def get_plugin_info(self, plugin_id: str):
            return SimpleNamespace(
                verification_status="unsigned",
                verification_message="unsigned",
                signing_key_id=None,
            )

        def enable_plugin(self, plugin_id: str, enabled: bool) -> bool:
            return True

    monkeypatch.setattr(provider_plugins, "get_provider_plugin_manager", lambda: _FakeManager())
    monkeypatch.setattr(provider_plugins, "reload_provider_registry", lambda: None)
    monkeypatch.setattr(
        provider_plugins,
        "_ensure_provider_settings_initialized",
        lambda provider, *, enabled, base_url: None,
    )

    response = await provider_plugins.install_provider_plugin_from_repo(
        provider_plugins.InstallProviderPluginFromRepoInput(
            repoUrl="https://github.com/acme/plugin",
            ref="main",
            pluginPath="providers/sample",
        )
    )

    assert response.id == "repo_plugin"
    assert captured["install_kwargs"]["repo_url"] == "https://github.com/acme/plugin"
    assert captured["install_kwargs"]["ref"] == "main"


@pytest.mark.asyncio
async def test_import_provider_plugin_blocks_in_safe_mode(monkeypatch, tmp_path: Path) -> None:
    class _FakeManager:
        def is_install_blocked_by_policy(self, source_class: str) -> bool:
            return source_class == "community"

    class _Upload:
        filename = "plugin.zip"

        async def read(self) -> bytes:
            return b"zip"

    monkeypatch.setattr(provider_plugins, "get_provider_plugin_manager", lambda: _FakeManager())

    with pytest.raises(ValueError, match="blocked in Safe mode"):
        await provider_plugins.import_provider_plugin(_Upload())
