from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from backend.services import provider_plugin_manager as ppm


def _write_code_plugin(source_dir: Path, *, plugin_id: str, provider: str) -> None:
    (source_dir / "provider.yaml").write_text(
        "\n".join(
            [
                "manifest_version: '1'",
                f"id: {plugin_id}",
                f"name: {plugin_id}",
                "version: 0.1.0",
                f"provider: {provider}",
                "entrypoint: plugin:create_provider",
                "description: test plugin",
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
                "        return [{'id': 'x', 'name': 'X'}]",
                "",
                "    def get_model(model_id, provider_options=None):",
                "        return {'provider': provider_id, 'model': model_id}",
                "",
                "    async def test_connection():",
                "        return True, None",
                "",
                "    return {'get_model': get_model, 'fetch_models': fetch_models, 'test_connection': test_connection}",
            ]
        )
    )


def _write_zip_from_dir(source_dir: Path, out_zip: Path) -> None:
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in source_dir.rglob("*"):
            if file_path.is_dir():
                continue
            zf.write(file_path, arcname=f"{source_dir.name}/{file_path.relative_to(source_dir).as_posix()}")


def _setup_manager(monkeypatch, tmp_path: Path) -> ppm.ProviderPluginManager:
    installed_root = tmp_path / "installed"
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}
    policy_store: dict[str, object] = {}
    index_store: list[dict[str, object]] = []

    monkeypatch.setattr(ppm, "_provider_plugin_manager", None)

    monkeypatch.setattr(ppm, "_load_plugin_states", lambda: dict(state_store))

    def _save_states(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(ppm, "_save_plugin_states", _save_states)

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
            return

    monkeypatch.setattr(ppm.db, "get_user_setting", _get_user_setting)
    monkeypatch.setattr(ppm.db, "set_user_setting", _set_user_setting)

    monkeypatch.setattr(ppm, "get_provider_plugins_directory", lambda: installed_root)
    monkeypatch.setattr(ppm, "get_provider_plugin_directory", lambda plugin_id: installed_root / plugin_id)

    return ppm.ProviderPluginManager()


def test_policy_defaults_and_save(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    policy = manager.get_policy()
    assert policy.mode == "safe"
    assert policy.auto_update_enabled is False

    saved = manager.save_policy(
        mode="unsafe",
        auto_update_enabled=True,
        community_warning_accepted=True,
    )
    assert saved.mode == "unsafe"
    assert saved.auto_update_enabled is True
    assert manager.get_policy().community_warning_accepted is True


def test_indexes_add_remove_refresh(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    index = manager.add_index(name="Community Index", url="https://example.com/index.json")
    assert index.id.startswith("custom-")

    monkeypatch.setattr(
        ppm,
        "_fetch_index_sources",
        lambda idx: [
            ppm.ProviderPluginSourceEntry(
                id="plugin-a",
                plugin_id="plugin_a",
                name="Plugin A",
                version="0.1.0",
                provider="plugin_a",
                description="a",
                icon="openai",
                source_class=idx.source_class,
                index_id=idx.id,
                index_name=idx.name,
                source_url=idx.url,
                repo_url="https://github.com/acme/plugin-a",
                tracking_ref="main",
                plugin_path=None,
            )
        ],
    )

    count = manager.refresh_index(index.id)
    assert count == 1
    assert manager.remove_index(index.id) is True


def test_safe_mode_blocks_community_enable(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

    plugin_id = manager.import_from_directory(
        source,
        source_type="repo",
        source_ref="https://github.com/acme/community-plugin",
        source_class="community",
    )
    assert plugin_id == "community-plugin"

    manager.enable_plugin(plugin_id, True)
    manager.save_policy(mode="safe", auto_update_enabled=False, community_warning_accepted=False)

    assert manager.get_enabled_manifests() == []
    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.blocked_by_policy is True


def test_set_auto_update_override(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

    plugin_id = manager.import_from_directory(
        source,
        source_type="repo",
        source_ref="https://github.com/acme/community-plugin",
        source_class="community",
        tracking_ref="main",
    )

    assert manager.set_auto_update(plugin_id, override="enabled", tracking_ref="main") is True
    manager.save_policy(mode="unsafe", auto_update_enabled=False, community_warning_accepted=True)
    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.auto_update_override == "enabled"
    assert plugin.effective_auto_update is True


def test_update_check_failure_keeps_plugin(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    manager.save_policy(mode="unsafe", auto_update_enabled=True, community_warning_accepted=True)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

    plugin_id = manager.import_from_directory(
        source,
        source_type="repo",
        source_ref="https://github.com/acme/community-plugin",
        source_class="community",
        repo_url="https://github.com/acme/community-plugin",
        tracking_ref="main",
    )

    manager.enable_plugin(plugin_id, True)
    manager.set_auto_update(plugin_id, override="enabled", tracking_ref="main")

    monkeypatch.setattr(ppm, "_download_github_archive", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("download failed")))

    results = manager.run_update_check()
    assert len(results) == 1
    assert results[0].status == "failed"

    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.update_error == "download failed"
    assert manager.get_manifest(plugin_id) is not None


def test_install_from_repo_uses_downloaded_archive(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    repo_src = tmp_path / "repo-src"
    plugin_subdir = repo_src / "plugins" / "my-plugin"
    plugin_subdir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(plugin_subdir, plugin_id="repo-plugin", provider="repo_plugin")

    archive_path = tmp_path / "repo.zip"
    _write_zip_from_dir(repo_src, archive_path)

    monkeypatch.setattr(ppm, "_download_github_archive", lambda *_args, **_kwargs: archive_path.read_bytes())

    plugin_id = manager.install_from_repo(
        repo_url="https://github.com/acme/repo-plugin",
        ref="main",
        plugin_path="plugins/my-plugin",
        source_type="repo",
        source_ref="https://github.com/acme/repo-plugin",
        source_class="community",
    )

    assert plugin_id == "repo-plugin"
    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.repo_url == "https://github.com/acme/repo-plugin"
    assert plugin.plugin_path == "plugins/my-plugin"


@pytest.mark.parametrize(
    "repo_url",
    [
        "",
        "ftp://github.com/acme/repo",
        "https://notgithub.com/acme/repo",
    ],
)
def test_install_from_repo_validates_url(monkeypatch, tmp_path: Path, repo_url: str) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)
    with pytest.raises(ValueError):
        manager.install_from_repo(repo_url=repo_url, ref="main")
