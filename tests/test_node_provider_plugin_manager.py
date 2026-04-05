from __future__ import annotations

import io
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
import yaml

from backend.services.plugins import node_provider_plugin_manager as npm
from backend.services.plugins import plugin_install_utils, plugin_registry


def _write_plugin(
    source_dir: Path,
    *,
    plugin_id: str = 'sample_provider',
    manifest_updates: dict[str, object] | None = None,
    remove_fields: tuple[str, ...] = (),
    create_runtime_entrypoint: bool = True,
    create_definitions_file: bool = True,
) -> None:
    manifest: dict[str, object] = {
        'manifest_version': '1',
        'id': plugin_id,
        'name': 'Sample Provider',
        'version': '1.0.0',
        'runtime': {
            'kind': 'bun',
            'entrypoint': 'dist/main.js',
        },
        'definitions': {
            'source': 'file',
            'file': 'dist/definitions.json',
        },
    }

    for field in remove_fields:
        manifest.pop(field, None)

    if manifest_updates:
        manifest.update(manifest_updates)

    (source_dir / 'node-provider.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False))

    dist = source_dir / 'dist'
    dist.mkdir(parents=True, exist_ok=True)
    if create_runtime_entrypoint:
        (dist / 'main.js').write_text('console.log(JSON.stringify({ok:true,result:{definitions:[]}}))')
    if create_definitions_file:
        (dist / 'definitions.json').write_text('[]')


def _zip_bytes_from_directory(source_dir: Path, *, root_dir_name: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file_path in source_dir.rglob('*'):
            if not file_path.is_file():
                continue
            rel_path = file_path.relative_to(source_dir).as_posix()
            arcname = f'{root_dir_name}/{rel_path}' if root_dir_name else rel_path
            archive.write(file_path, arcname=arcname)
    return buffer.getvalue()


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

    plugin_dir = tmp_path / 'installed' / 'sample_provider'
    assert plugin_dir.exists()

    plugins = manager.list_plugins()
    assert len(plugins) == 1
    assert plugins[0].id == 'sample_provider'
    assert plugins[0].enabled is True

    plugin_registry.register_plugin(
        'sample_provider',
        executors={'sample_provider:echo': object()},
        metadata={'source': 'provider'},
    )
    assert plugin_registry.get_executor('sample_provider:echo') is not None

    assert manager.enable_plugin('sample_provider', False) is True
    assert plugin_registry.get_plugin_metadata('sample_provider') is None
    assert plugin_registry.get_executor('sample_provider:echo') is None
    assert [m.id for m in manager.get_enabled_manifests()] == []

    assert manager.enable_plugin('sample_provider', True) is True
    assert [m.id for m in manager.get_enabled_manifests()] == ['sample_provider']

    plugin_registry.register_plugin(
        'sample_provider',
        executors={'sample_provider:echo': object()},
        metadata={'source': 'provider'},
    )
    assert manager.uninstall('sample_provider') is True
    assert manager.list_plugins() == []
    assert plugin_registry.get_plugin_metadata('sample_provider') is None
    assert plugin_registry.get_executor('sample_provider:echo') is None
    assert 'sample_provider' not in plugin_registry.list_registered_plugins()
    assert not plugin_dir.exists()


def test_install_from_repo_success_with_https_github_and_plugin_path(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    repo_root = tmp_path / 'repo-root'
    plugin_dir = repo_root / 'plugins' / 'sample'
    plugin_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(plugin_dir, plugin_id='repo_plugin')

    archive_bytes = _zip_bytes_from_directory(repo_root, root_dir_name='acme-plugin-main')
    monkeypatch.setattr(
        plugin_install_utils,
        'download_github_archive',
        lambda *_args, **_kwargs: archive_bytes,
    )

    plugin_id = manager.install_from_repo(
        repo_url='https://github.com/acme/plugin',
        ref='main',
        plugin_path='plugins/sample',
    )

    assert plugin_id == 'repo_plugin'
    plugin = manager.list_plugins()[0]
    assert plugin.source_type == 'repo'
    assert plugin.repo_url == 'https://github.com/acme/plugin'
    assert plugin.tracking_ref == 'main'
    assert plugin.plugin_path == 'plugins/sample'


@pytest.mark.parametrize(
    'repo_url, message',
    [
        ('http://github.com/acme/repo', 'repoUrl must use https:// for GitHub installs'),
        ('https://gitlab.com/acme/repo', 'Only GitHub repositories are supported for repo installs'),
    ],
)
def test_install_from_repo_rejects_invalid_urls(
    monkeypatch,
    tmp_path: Path,
    repo_url: str,
    message: str,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    with pytest.raises(ValueError, match=message):
        manager.install_from_repo(repo_url=repo_url)


@pytest.mark.parametrize('plugin_path', ['../evil', '/absolute/path'])
def test_install_from_repo_rejects_invalid_plugin_path(
    monkeypatch,
    tmp_path: Path,
    plugin_path: str,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    with pytest.raises(ValueError, match='pluginPath must be a relative path without traversal'):
        manager.install_from_repo(
            repo_url='https://github.com/acme/plugin',
            plugin_path=plugin_path,
        )


def test_install_from_repo_rejects_missing_plugin_path_in_archive(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    repo_root = tmp_path / 'repo-root'
    repo_root.mkdir(parents=True, exist_ok=True)
    (repo_root / 'README.md').write_text('placeholder')
    archive_bytes = _zip_bytes_from_directory(repo_root, root_dir_name='acme-plugin-main')

    monkeypatch.setattr(
        plugin_install_utils,
        'download_github_archive',
        lambda *_args, **_kwargs: archive_bytes,
    )

    with pytest.raises(ValueError, match='pluginPath not found in repository archive'):
        manager.install_from_repo(
            repo_url='https://github.com/acme/plugin',
            plugin_path='plugins/missing',
        )


def test_import_from_zip_success_with_wrapper_directory(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    plugin_source = tmp_path / 'zip-source'
    plugin_source.mkdir(parents=True, exist_ok=True)
    _write_plugin(plugin_source, plugin_id='zip_plugin')

    zip_bytes = _zip_bytes_from_directory(plugin_source, root_dir_name='wrapper-dir')

    plugin_id = manager.import_from_zip(zip_data=zip_bytes)

    assert plugin_id == 'zip_plugin'
    assert (tmp_path / 'installed' / 'zip_plugin' / 'node-provider.yaml').exists()


def test_import_from_zip_rejects_oversized_archive(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    oversized = b'x' * (npm.MAX_NODE_PROVIDER_PLUGIN_SIZE_BYTES + 1)

    with pytest.raises(ValueError, match='Node provider plugin archive exceeds 20MB limit'):
        manager.import_from_zip(zip_data=oversized)


def test_import_from_zip_rejects_path_traversal_entries(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('../evil.txt', 'malicious')

    with pytest.raises(ValueError, match='Archive contains invalid path traversal entries'):
        manager.import_from_zip(zip_data=buffer.getvalue())


@pytest.mark.parametrize('member_name', ['../evil.txt', '/absolute/evil.txt'])
def test_install_from_repo_rejects_path_traversal_entries(
    monkeypatch,
    tmp_path: Path,
    member_name: str,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name, 'malicious')

    monkeypatch.setattr(
        plugin_install_utils,
        'download_github_archive',
        lambda *_args, **_kwargs: buffer.getvalue(),
    )

    with pytest.raises(ValueError, match='Archive contains invalid path traversal entries'):
        manager.install_from_repo(repo_url='https://github.com/acme/plugin')


def test_import_from_zip_rejects_missing_manifest(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('README.md', 'not a plugin')

    with pytest.raises(ValueError, match='Node provider plugin is missing node-provider.yaml'):
        manager.import_from_zip(zip_data=buffer.getvalue())


@pytest.mark.parametrize(
    'manifest_updates, remove_fields, message',
    [
        ({'manifest_version': '2'}, (), 'Unsupported node provider manifest version: 2'),
        ({}, ('id',), 'Node provider manifest missing required field: id'),
        ({}, ('name',), 'Node provider manifest missing required field: name'),
        ({}, ('version',), 'Node provider manifest missing required field: version'),
        ({}, ('runtime',), 'Node provider manifest missing required object: runtime'),
        ({'id': 'Invalid.Plugin'}, (), 'Node provider plugin id must match'),
        ({'runtime': {'kind': 'bun'}}, (), 'Node provider runtime.entrypoint is required'),
    ],
)
def test_manifest_validation_errors_are_actionable(
    monkeypatch,
    tmp_path: Path,
    manifest_updates: dict[str, object],
    remove_fields: tuple[str, ...],
    message: str,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'bad-plugin'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(
        source_dir,
        plugin_id='sample_provider',
        manifest_updates=manifest_updates,
        remove_fields=remove_fields,
    )

    with pytest.raises(ValueError, match=message):
        manager.import_from_directory(source_dir)


def test_manifest_validation_rejects_missing_runtime_entrypoint_file(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'missing-runtime-file'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(source_dir, create_runtime_entrypoint=False)

    with pytest.raises(ValueError, match='Node provider runtime entrypoint not found'):
        manager.import_from_directory(source_dir)


def test_manifest_validation_rejects_invalid_python_dependencies_shape(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'bad-dependencies-shape'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(source_dir, manifest_updates={'python_dependencies': 'requests==2.0.0'})

    with pytest.raises(ValueError, match='python_dependencies must be a list'):
        manager.import_from_directory(source_dir)


def test_manifest_validation_rejects_invalid_python_dependency_entries(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'bad-dependency-item'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(source_dir, manifest_updates={'python_dependencies': ['valid', '']})

    with pytest.raises(ValueError, match='python dependency entries must be non-empty strings'):
        manager.import_from_directory(source_dir)


def test_import_installs_manifest_python_dependencies(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'dependency-plugin'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(
        source_dir,
        manifest_updates={'python_dependencies': ['requests==2.32.3']},
    )

    captured: dict[str, object] = {}

    def _fake_install(dependencies: list[str], *, plugin_id: str, working_directory: Path):
        captured['dependencies'] = dependencies
        captured['plugin_id'] = plugin_id
        captured['working_directory'] = working_directory
        return npm.NodeProviderDependencyInstallResult(success=True)

    monkeypatch.setattr(npm, '_install_python_dependencies', _fake_install)

    plugin_id = manager.import_from_directory(source_dir)

    assert plugin_id == 'sample_provider'
    assert captured['dependencies'] == ['requests==2.32.3']
    assert captured['plugin_id'] == 'sample_provider'
    assert isinstance(captured['working_directory'], Path)


def test_import_installs_manifest_dependencies_python_alias(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'dependency-alias-plugin'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(
        source_dir,
        manifest_updates={'dependencies': {'python': ['pydantic==2.11.7']}},
    )

    captured: dict[str, object] = {}

    def _fake_install(dependencies: list[str], *, plugin_id: str, working_directory: Path):
        captured['dependencies'] = dependencies
        return npm.NodeProviderDependencyInstallResult(success=True)

    monkeypatch.setattr(npm, '_install_python_dependencies', _fake_install)

    manager.import_from_directory(source_dir)
    assert captured['dependencies'] == ['pydantic==2.11.7']


def test_import_dependency_install_failure_is_actionable_and_rolls_back(
    monkeypatch,
    tmp_path: Path,
) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    source_dir = tmp_path / 'dependency-failure-plugin'
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_plugin(
        source_dir,
        plugin_id='dependency_plugin',
        manifest_updates={'python_dependencies': ['bad-package===0.0.0']},
    )

    monkeypatch.setattr(
        npm,
        '_install_python_dependencies',
        lambda *_args, **_kwargs: npm.NodeProviderDependencyInstallResult(
            success=False,
            message='uv pip install failed for plugin dependency_plugin: No matching distribution found',
        ),
    )

    with pytest.raises(ValueError, match='uv pip install failed for plugin dependency_plugin'):
        manager.import_from_directory(source_dir)

    assert not (tmp_path / 'installed' / 'dependency_plugin').exists()
    assert manager.list_plugins() == []


def test_install_python_dependencies_tries_uv_then_pip_fallback(monkeypatch, tmp_path: Path) -> None:
    calls: list[list[str]] = []

    def _fake_run(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        if command[:3] == ['uv', 'pip', 'install']:
            return subprocess.CompletedProcess(command, returncode=1, stdout='', stderr='uv failed')
        return subprocess.CompletedProcess(command, returncode=0, stdout='ok', stderr='')

    monkeypatch.setattr(npm.subprocess, 'run', _fake_run)

    result = npm._install_python_dependencies(
        ['requests==2.32.3'],
        plugin_id='dep_plugin',
        working_directory=tmp_path,
    )

    assert result.success is True
    assert calls[0][:3] == ['uv', 'pip', 'install']
    assert calls[1][:3] == [sys.executable, '-m', 'pip']


def test_install_python_dependencies_returns_clear_error_on_failure(monkeypatch, tmp_path: Path) -> None:
    def _fake_run(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, returncode=1, stdout='', stderr='dependency resolution failed')

    monkeypatch.setattr(npm.subprocess, 'run', _fake_run)

    result = npm._install_python_dependencies(
        ['definitely-not-a-real-package==0.0.1'],
        plugin_id='dep_plugin',
        working_directory=tmp_path,
    )

    assert result.success is False
    assert result.message is not None
    assert 'dep_plugin' in result.message
    assert 'dependency resolution failed' in result.message


def test_import_from_zip_rejects_multiple_manifest_roots(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    plugin_a = tmp_path / 'plugin-a'
    plugin_b = tmp_path / 'plugin-b'
    plugin_a.mkdir(parents=True, exist_ok=True)
    plugin_b.mkdir(parents=True, exist_ok=True)
    _write_plugin(plugin_a, plugin_id='plugin_a')
    _write_plugin(plugin_b, plugin_id='plugin_b')

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in plugin_a.rglob('*'):
            if path.is_file():
                archive.write(path, arcname=f'plugin-a/{path.relative_to(plugin_a).as_posix()}')
        for path in plugin_b.rglob('*'):
            if path.is_file():
                archive.write(path, arcname=f'plugin-b/{path.relative_to(plugin_b).as_posix()}')

    with pytest.raises(
        ValueError,
        match='Archive contains multiple node-provider.yaml manifests; include exactly one plugin manifest',
    ):
        manager.import_from_zip(zip_data=buffer.getvalue())
