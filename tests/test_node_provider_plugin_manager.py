from __future__ import annotations

from pathlib import Path

from backend.services import node_provider_plugin_manager as npm
from backend.services import plugin_registry


def _write_plugin(source_dir: Path, *, plugin_id: str = 'sample_provider') -> None:
    (source_dir / 'node-provider.yaml').write_text(
        '\n'.join(
            [
                "manifest_version: '1'",
                f"id: {plugin_id}",
                'name: Sample Provider',
                'version: 1.0.0',
                'runtime:',
                '  kind: bun',
                '  entrypoint: dist/main.js',
                'definitions:',
                '  source: file',
                '  file: dist/definitions.json',
            ]
        )
    )
    dist = source_dir / 'dist'
    dist.mkdir(parents=True, exist_ok=True)
    (dist / 'main.js').write_text('console.log(JSON.stringify({ok:true,result:{definitions:[]}}))')
    (dist / 'definitions.json').write_text('[]')


def _setup_manager(monkeypatch, tmp_path: Path) -> npm.NodeProviderPluginManager:
    installed_root = tmp_path / 'installed'
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}

    monkeypatch.setattr(npm, '_node_provider_plugin_manager', None)
    monkeypatch.setattr(npm, '_load_plugin_states', lambda: dict(state_store))

    def _save(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(npm, '_save_plugin_states', _save)
    monkeypatch.setattr(npm, 'get_node_provider_plugins_directory', lambda: installed_root)
    monkeypatch.setattr(
        npm,
        'get_node_provider_plugin_directory',
        lambda plugin_id: installed_root / plugin_id,
    )

    return npm.NodeProviderPluginManager()


def test_node_provider_plugin_manager_lifecycle(monkeypatch, tmp_path: Path) -> None:
    plugin_registry.unregister_plugin('sample_provider')
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'source-plugin'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(source_dir)

    plugin_id = manager.import_from_directory(source_dir)
    assert plugin_id == 'sample_provider'

    plugins = manager.list_plugins()
    assert len(plugins) == 1
    assert plugins[0].id == 'sample_provider'
    assert plugins[0].enabled is True

    plugin_registry.register_plugin('sample_provider')
    assert manager.enable_plugin('sample_provider', False) is True
    assert plugin_registry.get_plugin_metadata('sample_provider') is None
    assert [m.id for m in manager.get_enabled_manifests()] == []

    assert manager.enable_plugin('sample_provider', True) is True
    assert [m.id for m in manager.get_enabled_manifests()] == ['sample_provider']

    plugin_registry.register_plugin('sample_provider')
    assert manager.uninstall('sample_provider') is True
    assert manager.list_plugins() == []
    assert plugin_registry.get_plugin_metadata('sample_provider') is None
