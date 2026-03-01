from __future__ import annotations

from pathlib import Path

import pytest

from backend.services import provider_plugin_manager as ppm
from tests.provider_plugin_test_helpers import (
    setup_provider_plugin_manager,
    write_provider_code_plugin,
    write_zip_from_directory,
)


def _make_manager(monkeypatch, tmp_path: Path) -> ppm.ProviderPluginManager:
    return setup_provider_plugin_manager(
        monkeypatch,
        tmp_path,
        include_policy_storage=True,
    )


def test_policy_defaults_and_save(monkeypatch, tmp_path: Path) -> None:
    manager = _make_manager(monkeypatch, tmp_path)

    policy = manager.get_policy()
    assert policy.mode == "safe"
    assert policy.auto_update_enabled is False

    saved = manager.save_policy(
        mode="unsafe",
        auto_update_enabled=True,
    )
    assert saved.mode == "unsafe"
    assert saved.auto_update_enabled is True


def test_indexes_add_remove_refresh(monkeypatch, tmp_path: Path) -> None:
    manager = _make_manager(monkeypatch, tmp_path)

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
    manager = _make_manager(monkeypatch, tmp_path)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

    plugin_id = manager.import_from_directory(
        source,
        source_type="repo",
        source_ref="https://github.com/acme/community-plugin",
        source_class="community",
    )
    assert plugin_id == "community-plugin"

    manager.enable_plugin(plugin_id, True)
    manager.save_policy(mode="safe", auto_update_enabled=False)

    assert manager.get_enabled_manifests() == []
    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.blocked_by_policy is True


def test_set_auto_update_override(monkeypatch, tmp_path: Path) -> None:
    manager = _make_manager(monkeypatch, tmp_path)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

    plugin_id = manager.import_from_directory(
        source,
        source_type="repo",
        source_ref="https://github.com/acme/community-plugin",
        source_class="community",
        tracking_ref="main",
    )

    assert manager.set_auto_update(plugin_id, override="enabled", tracking_ref="main") is True
    manager.save_policy(mode="unsafe", auto_update_enabled=False)
    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.auto_update_override == "enabled"
    assert plugin.effective_auto_update is True


def test_update_check_failure_keeps_plugin(monkeypatch, tmp_path: Path) -> None:
    manager = _make_manager(monkeypatch, tmp_path)
    manager.save_policy(mode="unsafe", auto_update_enabled=True)

    source = tmp_path / "plugin-src"
    source.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(source, plugin_id="community-plugin", provider="community_plugin")

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

    monkeypatch.setattr(
        ppm.plugin_install_utils,
        "download_github_archive",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("download failed")),
    )

    results = manager.run_update_check()
    assert len(results) == 1
    assert results[0].status == "failed"

    plugin = manager.get_plugin_info(plugin_id)
    assert plugin is not None
    assert plugin.update_error == "download failed"
    assert manager.get_manifest(plugin_id) is not None


def test_install_from_repo_uses_downloaded_archive(monkeypatch, tmp_path: Path) -> None:
    manager = _make_manager(monkeypatch, tmp_path)

    repo_src = tmp_path / "repo-src"
    plugin_subdir = repo_src / "plugins" / "my-plugin"
    plugin_subdir.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(plugin_subdir, plugin_id="repo-plugin", provider="repo_plugin")

    archive_path = tmp_path / "repo.zip"
    write_zip_from_directory(repo_src, archive_path)

    monkeypatch.setattr(
        ppm.plugin_install_utils,
        "download_github_archive",
        lambda *_args, **_kwargs: archive_path.read_bytes(),
    )

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
    manager = _make_manager(monkeypatch, tmp_path)
    with pytest.raises(ValueError):
        manager.install_from_repo(repo_url=repo_url, ref="main")
