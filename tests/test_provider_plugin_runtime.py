from __future__ import annotations

import importlib
from pathlib import Path

from tests.provider_plugin_test_helpers import (
    setup_provider_plugin_manager,
    write_provider_code_plugin,
    write_zip_from_directory,
)


def test_provider_registry_loads_code_plugin_from_directory(monkeypatch, tmp_path: Path) -> None:
    manager = setup_provider_plugin_manager(monkeypatch, tmp_path)

    source_dir = tmp_path / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(
        source_dir,
        plugin_id="runtime-code-plugin",
        provider="runtime_code_provider",
        name="Runtime Code Plugin",
        version="0.2.0",
        aliases=["runtime-code"],
        description="Runtime code provider",
        model_id="runtime-model",
        model_name="Runtime Model",
    )
    manager.import_from_directory(source_dir)

    providers_module = importlib.import_module("backend.providers")
    providers_module.reload_provider_registry()

    assert "runtime_code_provider" in providers_module.PROVIDERS
    assert providers_module.ALIASES["runtime_code"] == "runtime_code_provider"


def test_provider_plugin_import_from_zip(monkeypatch, tmp_path: Path) -> None:
    manager = setup_provider_plugin_manager(monkeypatch, tmp_path)

    source_dir = tmp_path / "zip-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    write_provider_code_plugin(
        source_dir,
        plugin_id="runtime-code-plugin",
        provider="runtime_code_provider",
        name="Runtime Code Plugin",
        version="0.2.0",
        aliases=["runtime-code"],
        description="Runtime code provider",
        model_id="runtime-model",
        model_name="Runtime Model",
    )

    zip_path = tmp_path / "runtime-plugin.zip"
    write_zip_from_directory(source_dir, zip_path, root_dir_name="runtime-code-plugin")

    plugin_id = manager.import_from_zip(zip_path)
    assert plugin_id == "runtime-code-plugin"
    assert (tmp_path / "installed" / "runtime-code-plugin" / "provider.yaml").exists()
