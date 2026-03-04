from __future__ import annotations

import pytest

import backend.commands.node_provider_plugins as node_provider_plugins


@pytest.mark.asyncio
async def test_import_node_provider_plugin_triggers_registry_reload(monkeypatch) -> None:
    reload_calls = 0

    class _FakeUpload:
        filename = "plugin.zip"

        async def read(self) -> bytes:
            return b"zip-content"

    class _FakeManager:
        def import_from_zip(self, **_kwargs):
            return "sample"

    def _reload() -> None:
        nonlocal reload_calls
        reload_calls += 1

    monkeypatch.setattr(node_provider_plugins, "get_node_provider_plugin_manager", lambda: _FakeManager())
    monkeypatch.setattr(node_provider_plugins, "reload_node_provider_registry", _reload)

    response = await node_provider_plugins.import_node_provider_plugin(_FakeUpload())

    assert response == {"id": "sample"}
    assert reload_calls == 1


@pytest.mark.asyncio
async def test_import_node_provider_plugin_from_directory_triggers_registry_reload(monkeypatch) -> None:
    reload_calls = 0

    class _FakeManager:
        def import_from_directory(self, *_args, **_kwargs):
            return "sample"

    def _reload() -> None:
        nonlocal reload_calls
        reload_calls += 1

    monkeypatch.setattr(node_provider_plugins, "get_node_provider_plugin_manager", lambda: _FakeManager())
    monkeypatch.setattr(node_provider_plugins, "reload_node_provider_registry", _reload)

    response = await node_provider_plugins.import_node_provider_plugin_from_directory(
        node_provider_plugins.InstallNodeProviderPluginFromDirectoryInput(path="/tmp/plugin")
    )

    assert response == {"id": "sample"}
    assert reload_calls == 1


@pytest.mark.asyncio
async def test_install_node_provider_plugin_from_repo_triggers_registry_reload(monkeypatch) -> None:
    reload_calls = 0

    class _FakeManager:
        def install_from_repo(self, **_kwargs):
            return "sample"

    def _reload() -> None:
        nonlocal reload_calls
        reload_calls += 1

    monkeypatch.setattr(node_provider_plugins, "get_node_provider_plugin_manager", lambda: _FakeManager())
    monkeypatch.setattr(node_provider_plugins, "reload_node_provider_registry", _reload)

    response = await node_provider_plugins.install_node_provider_plugin_from_repo(
        node_provider_plugins.InstallNodeProviderPluginFromRepoInput(
            repoUrl="https://github.com/acme/plugin",
            ref="main",
            pluginPath="plugins/sample",
        )
    )

    assert response == {"id": "sample"}
    assert reload_calls == 1
