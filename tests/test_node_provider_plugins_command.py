
from __future__ import annotations

from types import SimpleNamespace

import pytest

import backend.commands.node_provider_plugins as node_provider_plugins
from backend.models.node_provider import NodeProviderNodeDefinition


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


@pytest.mark.asyncio
async def test_list_node_provider_definitions_uses_registry_listing(monkeypatch) -> None:
  command_fn = node_provider_plugins.list_node_provider_definitions

  monkeypatch.setattr(
      node_provider_plugins,
      'list_provider_definitions_from_registry',
      lambda: [
          NodeProviderNodeDefinition(
              type='sample-provider:echo',
              name='Echo',
              description='Echo node',
              category='utility',
              icon='square',
              executionMode='flow',
              parameters=[],
              providerId='sample-provider',
              pluginId='sample-provider',
          )
      ],
  )

  response = await command_fn()

  assert len(response.definitions) == 1
  assert response.definitions[0].type == 'sample-provider:echo'
  assert response.definitions[0].providerId == 'sample-provider'


@pytest.mark.asyncio
async def test_enable_node_provider_plugin_toggles_state_and_reloads_registry(monkeypatch) -> None:
  captured: dict[str, object] = {}
  reload_calls = 0

  class _FakeManager:
      def enable_plugin(self, plugin_id: str, enabled: bool) -> bool:
          captured['plugin_id'] = plugin_id
          captured['enabled'] = enabled
          return True

  def _reload() -> None:
      nonlocal reload_calls
      reload_calls += 1

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  monkeypatch.setattr(node_provider_plugins, 'reload_node_provider_registry', _reload)

  response = await node_provider_plugins.enable_node_provider_plugin(
      node_provider_plugins.EnableNodeProviderPluginInput(id='sample', enabled=False)
  )

  assert response == {'success': True, 'enabled': False}
  assert captured == {'plugin_id': 'sample', 'enabled': False}
  assert reload_calls == 1


@pytest.mark.asyncio
async def test_enable_node_provider_plugin_raises_for_unknown_plugin(monkeypatch) -> None:
  reload_calls = 0

  class _FakeManager:
      def enable_plugin(self, plugin_id: str, enabled: bool) -> bool:
          return False

  def _reload() -> None:
      nonlocal reload_calls
      reload_calls += 1

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  monkeypatch.setattr(node_provider_plugins, 'reload_node_provider_registry', _reload)

  with pytest.raises(ValueError, match="Node provider plugin 'missing' not found"):
      await node_provider_plugins.enable_node_provider_plugin(
          node_provider_plugins.EnableNodeProviderPluginInput(id='missing', enabled=True)
      )

  assert reload_calls == 0


@pytest.mark.asyncio
async def test_uninstall_node_provider_plugin_uninstalls_and_reloads_registry(monkeypatch) -> None:
  reload_calls = 0

  class _FakeManager:
      def uninstall(self, plugin_id: str) -> bool:
          return plugin_id == 'sample'

  def _reload() -> None:
      nonlocal reload_calls
      reload_calls += 1

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  monkeypatch.setattr(node_provider_plugins, 'reload_node_provider_registry', _reload)

  response = await node_provider_plugins.uninstall_node_provider_plugin(
      node_provider_plugins.NodeProviderPluginIdInput(id='sample')
  )

  assert response == {'success': True}
  assert reload_calls == 1


@pytest.mark.asyncio
async def test_uninstall_node_provider_plugin_raises_for_unknown_plugin(monkeypatch) -> None:
  reload_calls = 0

  class _FakeManager:
      def uninstall(self, plugin_id: str) -> bool:
          return False

  def _reload() -> None:
      nonlocal reload_calls
      reload_calls += 1

  monkeypatch.setattr(node_provider_plugins, 'get_node_provider_plugin_manager', lambda: _FakeManager())
  monkeypatch.setattr(node_provider_plugins, 'reload_node_provider_registry', _reload)

  with pytest.raises(ValueError, match="Node provider plugin 'missing' not found"):
      await node_provider_plugins.uninstall_node_provider_plugin(
          node_provider_plugins.NodeProviderPluginIdInput(id='missing')
      )

  assert reload_calls == 0
