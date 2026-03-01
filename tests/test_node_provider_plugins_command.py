
from __future__ import annotations

from types import SimpleNamespace

import pytest

import backend.commands.node_provider_plugins as node_provider_plugins


@pytest.mark.asyncio
async def test_list_node_provider_plugins(monkeypatch) -> None:
  class _FakeManager:
      def list_plugins(self):
          return [
              SimpleNamespace(
                  id='sample',
                  name='Sample',
                  version='1.0.0',
                  enabled=True,
                  installed_at='2026-03-01T00:00:00Z',
                  source_type='local',
                  source_ref='/tmp/plugin',
                  repo_url=None,
                  tracking_ref=None,
                  plugin_path=None,
                  error=None,
              )
          ]

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  response = await node_provider_plugins.list_node_provider_plugins()
  assert len(response.plugins) == 1
  assert response.plugins[0].id == 'sample'


@pytest.mark.asyncio
async def test_install_node_provider_plugin_from_repo(monkeypatch) -> None:
  captured: dict[str, object] = {}

  class _FakeManager:
      def install_from_repo(self, **kwargs):
          captured['kwargs'] = kwargs
          return 'sample'

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  monkeypatch.setattr(node_provider_plugins, 'reload_node_provider_registry', lambda: None)

  response = await node_provider_plugins.install_node_provider_plugin_from_repo(
      node_provider_plugins.InstallNodeProviderPluginFromRepoInput(
          repoUrl='https://github.com/acme/plugin',
          ref='main',
          pluginPath='plugins/sample',
      )
  )

  assert response['id'] == 'sample'
  assert captured['kwargs']['repo_url'] == 'https://github.com/acme/plugin'
