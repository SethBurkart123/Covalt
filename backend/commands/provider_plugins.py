from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from .. import db
from ..models.chat import (
    EnableProviderPluginInput,
    ImportProviderPluginResponse,
    InstallProviderPluginSourceInput,
    ProviderPluginIdInput,
    ProviderPluginInfo,
    ProviderPluginSourceInfo,
    ProviderPluginSourcesResponse,
    ProviderPluginsResponse,
)
from ..providers import reload_provider_registry
from ..services.provider_plugin_manager import get_provider_plugin_manager

logger = logging.getLogger(__name__)

MAX_PROVIDER_PLUGIN_SIZE = "20MB"
ALLOWED_PROVIDER_PLUGIN_TYPES = ["application/zip", "application/x-zip-compressed"]


class InstallProviderPluginFromDirectoryInput(BaseModel):
    path: str


_PROVIDER_PLUGIN_SOURCES: tuple[dict[str, str], ...] = (
    {
        "id": "sample-openai-adapter",
        "plugin_id": "sample_openai_adapter",
        "name": "Sample OpenAI Adapter Provider",
        "version": "0.1.0",
        "provider": "sample_openai_adapter",
        "description": "Template plugin using adapter-based provider manifest.",
        "icon": "openai",
        "path": "examples/provider-plugins/sample-openai-adapter",
    },
    {
        "id": "sample-code-provider",
        "plugin_id": "sample_code_provider",
        "name": "Sample Code Provider",
        "version": "0.1.0",
        "provider": "sample_code_provider",
        "description": "Template plugin with custom Python provider factory entrypoint.",
        "icon": "openai",
        "path": "examples/provider-plugins/sample-code-provider",
    },
)


def _ensure_provider_settings_initialized(
    provider: str,
    *,
    enabled: bool,
    base_url: str | None,
) -> None:
    with db.db_session() as sess:
        existing = db.get_provider_settings(sess, provider)
        if existing:
            db.save_provider_settings(
                sess,
                provider=provider,
                enabled=enabled,
            )
            return

        db.save_provider_settings(
            sess,
            provider=provider,
            base_url=base_url,
            enabled=enabled,
        )


def _set_provider_enabled(provider: str, *, enabled: bool) -> None:
    with db.db_session() as sess:
        db.save_provider_settings(
            sess,
            provider=provider,
            enabled=enabled,
        )


@command
async def list_provider_plugin_sources() -> ProviderPluginSourcesResponse:
    manager = get_provider_plugin_manager()
    installed_ids = {plugin.id for plugin in manager.list_plugins()}

    return ProviderPluginSourcesResponse(
        sources=[
            ProviderPluginSourceInfo(
                id=source["id"],
                pluginId=source["plugin_id"],
                name=source["name"],
                version=source["version"],
                provider=source["provider"],
                description=source["description"],
                icon=source["icon"],
                installed=source["plugin_id"] in installed_ids,
            )
            for source in _PROVIDER_PLUGIN_SOURCES
        ]
    )


@command
async def install_provider_plugin_source(
    body: InstallProviderPluginSourceInput,
) -> ImportProviderPluginResponse:
    source = next((item for item in _PROVIDER_PLUGIN_SOURCES if item["id"] == body.id), None)
    if source is None:
        raise ValueError(f"Unknown provider plugin source '{body.id}'")

    root = Path(__file__).resolve().parents[2]
    source_path = root / source["path"]
    if not source_path.exists():
        raise ValueError(f"Provider plugin source path not found: {source_path}")

    manager = get_provider_plugin_manager()
    plugin_id = manager.import_from_directory(source_path)

    manifest = manager.get_manifest(plugin_id)
    if manifest is None:
        raise RuntimeError(f"Provider plugin '{plugin_id}' not found after install")

    _ensure_provider_settings_initialized(
        manifest.provider,
        enabled=manifest.default_enabled,
        base_url=manifest.default_base_url,
    )

    reload_provider_registry()
    logger.info("Installed provider plugin source '%s'", body.id)

    return ImportProviderPluginResponse(
        id=manifest.id,
        provider=manifest.provider,
        name=manifest.name,
        version=manifest.version,
    )


@command
async def list_provider_plugins() -> ProviderPluginsResponse:
    manager = get_provider_plugin_manager()
    plugins = [
        ProviderPluginInfo(
            id=item.id,
            name=item.name,
            version=item.version,
            provider=item.provider,
            enabled=item.enabled,
            installedAt=item.installed_at,
            sourceType=item.source_type,
            sourceRef=item.source_ref,
            description=item.description,
            icon=item.icon,
            authType=item.auth_type,
            defaultBaseUrl=item.default_base_url,
            defaultEnabled=item.default_enabled,
            oauthVariant=item.oauth_variant,
            oauthEnterpriseDomain=item.oauth_enterprise_domain,
            aliases=item.aliases,
            error=item.error,
        )
        for item in manager.list_plugins()
    ]
    return ProviderPluginsResponse(plugins=plugins)


@upload(max_size=MAX_PROVIDER_PLUGIN_SIZE, allowed_types=ALLOWED_PROVIDER_PLUGIN_TYPES)
async def import_provider_plugin(file: UploadFile) -> ImportProviderPluginResponse:
    manager = get_provider_plugin_manager()
    plugin_id = manager.import_from_zip(
        zip_data=await file.read(),
        source_type="zip",
        source_ref=file.filename,
    )

    manifest = manager.get_manifest(plugin_id)
    if manifest is None:
        raise RuntimeError(f"Provider plugin '{plugin_id}' not found after import")

    _ensure_provider_settings_initialized(
        manifest.provider,
        enabled=manifest.default_enabled,
        base_url=manifest.default_base_url,
    )

    reload_provider_registry()
    logger.info("Imported provider plugin '%s' from %s", plugin_id, file.filename)
    return ImportProviderPluginResponse(
        id=manifest.id,
        provider=manifest.provider,
        name=manifest.name,
        version=manifest.version,
    )


@command
async def import_provider_plugin_from_directory(
    body: InstallProviderPluginFromDirectoryInput,
) -> ImportProviderPluginResponse:
    manager = get_provider_plugin_manager()
    plugin_id = manager.import_from_directory(Path(body.path))

    manifest = manager.get_manifest(plugin_id)
    if manifest is None:
        raise RuntimeError(f"Provider plugin '{plugin_id}' not found after import")

    _ensure_provider_settings_initialized(
        manifest.provider,
        enabled=manifest.default_enabled,
        base_url=manifest.default_base_url,
    )

    reload_provider_registry()
    logger.info("Imported provider plugin '%s' from directory %s", plugin_id, body.path)
    return ImportProviderPluginResponse(
        id=manifest.id,
        provider=manifest.provider,
        name=manifest.name,
        version=manifest.version,
    )


@command
async def enable_provider_plugin(body: EnableProviderPluginInput) -> dict[str, bool]:
    manager = get_provider_plugin_manager()
    manifest = manager.get_manifest(body.id)
    if manifest is None:
        raise ValueError(f"Provider plugin '{body.id}' not found")

    if not manager.enable_plugin(body.id, body.enabled):
        raise ValueError(f"Provider plugin '{body.id}' not found")

    _set_provider_enabled(manifest.provider, enabled=body.enabled)
    reload_provider_registry()
    return {"success": True, "enabled": body.enabled}


@command
async def uninstall_provider_plugin(body: ProviderPluginIdInput) -> dict[str, bool]:
    manager = get_provider_plugin_manager()
    manifest = manager.get_manifest(body.id)
    if manifest is None:
        raise ValueError(f"Provider plugin '{body.id}' not found")

    with db.db_session() as sess:
        provider_settings = db.get_provider_settings(sess, manifest.provider)
    if provider_settings and provider_settings.get("enabled", True):
        raise ValueError(
            f"Disable provider '{manifest.provider}' before uninstalling plugin '{body.id}'"
        )

    if not manager.uninstall(body.id):
        raise ValueError(f"Provider plugin '{body.id}' not found")

    reload_provider_registry()
    return {"success": True}
