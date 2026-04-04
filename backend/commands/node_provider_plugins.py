
from __future__ import annotations

from pathlib import Path

from zynk import UploadFile, command, upload

from ..models.node_provider import (
    EnableNodeProviderPluginInput,
    InstallNodeProviderPluginFromDirectoryInput,
    InstallNodeProviderPluginFromRepoInput,
    NodeProviderDefinitionsResponse,
    NodeProviderNodeDefinition,
    NodeProviderPluginIdInput,
    NodeProviderPluginInfo,
    NodeProviderPluginsResponse,
)
from ..services.node_provider_plugin_manager import get_node_provider_plugin_manager
from ..services.node_provider_registry import (
    list_node_provider_definitions as list_provider_definitions_from_registry,
)
from ..services.node_provider_registry import (
    reload_node_provider_registry,
)

MAX_NODE_PROVIDER_PLUGIN_SIZE = '20MB'
ALLOWED_NODE_PROVIDER_PLUGIN_TYPES = ['application/zip', 'application/x-zip-compressed']


@command
async def list_node_provider_plugins() -> NodeProviderPluginsResponse:
    manager = get_node_provider_plugin_manager()
    return NodeProviderPluginsResponse(
        plugins=[
            NodeProviderPluginInfo(
                id=item.id,
                name=item.name,
                version=item.version,
                enabled=item.enabled,
                installedAt=item.installed_at,
                sourceType=item.source_type,
                sourceRef=item.source_ref,
                repoUrl=item.repo_url,
                trackingRef=item.tracking_ref,
                pluginPath=item.plugin_path,
                error=item.error,
            )
            for item in manager.list_plugins()
        ]
    )


@upload(max_size=MAX_NODE_PROVIDER_PLUGIN_SIZE, allowed_types=ALLOWED_NODE_PROVIDER_PLUGIN_TYPES)
async def import_node_provider_plugin(file: UploadFile) -> dict[str, str]:
    manager = get_node_provider_plugin_manager()
    plugin_id = manager.import_from_zip(
        zip_data=await file.read(),
        source_type='zip',
        source_ref=file.filename,
    )
    reload_node_provider_registry()
    return {'id': plugin_id}


@command
async def import_node_provider_plugin_from_directory(
    body: InstallNodeProviderPluginFromDirectoryInput,
) -> dict[str, str]:
    manager = get_node_provider_plugin_manager()
    plugin_id = manager.import_from_directory(
        Path(body.path),
        source_type='local',
        source_ref=body.path,
    )
    reload_node_provider_registry()
    return {'id': plugin_id}


@command
async def install_node_provider_plugin_from_repo(
    body: InstallNodeProviderPluginFromRepoInput,
) -> dict[str, str]:
    manager = get_node_provider_plugin_manager()
    plugin_id = manager.install_from_repo(
        repo_url=body.repoUrl,
        ref=body.ref,
        plugin_path=body.pluginPath,
        source_type='repo',
        source_ref=body.repoUrl,
    )
    reload_node_provider_registry()
    return {'id': plugin_id}


@command
async def enable_node_provider_plugin(body: EnableNodeProviderPluginInput) -> dict[str, bool]:
    manager = get_node_provider_plugin_manager()
    if not manager.enable_plugin(body.id, body.enabled):
        raise ValueError(f"Node provider plugin '{body.id}' not found")
    reload_node_provider_registry()
    return {'success': True, 'enabled': body.enabled}


@command
async def uninstall_node_provider_plugin(body: NodeProviderPluginIdInput) -> dict[str, bool]:
    manager = get_node_provider_plugin_manager()
    if not manager.uninstall(body.id):
        raise ValueError(f"Node provider plugin '{body.id}' not found")
    reload_node_provider_registry()
    return {'success': True}


@command
async def list_node_provider_definitions() -> NodeProviderDefinitionsResponse:
    definitions = list_provider_definitions_from_registry()
    return NodeProviderDefinitionsResponse(
        definitions=[
            NodeProviderNodeDefinition.model_validate(item.model_dump())
            for item in definitions
        ]
    )
