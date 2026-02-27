from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from .. import db
from ..models.chat import (
    AddProviderPluginIndexInput,
    EnableProviderPluginInput,
    ImportProviderPluginResponse,
    InstallProviderPluginFromRepoInput,
    InstallProviderPluginSourceInput,
    ProviderPluginIdInput,
    ProviderPluginIndexInfo,
    ProviderPluginIndexesResponse,
    ProviderPluginInfo,
    ProviderPluginPolicy,
    ProviderPluginSourceInfo,
    ProviderPluginSourcesResponse,
    ProviderPluginUpdateCheckResponse,
    ProviderPluginUpdateItem,
    ProviderPluginsResponse,
    RefreshProviderPluginIndexInput,
    RemoveProviderPluginIndexInput,
    SaveProviderPluginPolicyInput,
    SetProviderPluginAutoUpdateInput,
)
from ..providers import reload_provider_registry
from ..services.provider_plugin_manager import get_provider_plugin_manager

logger = logging.getLogger(__name__)

MAX_PROVIDER_PLUGIN_SIZE = "20MB"
ALLOWED_PROVIDER_PLUGIN_TYPES = ["application/zip", "application/x-zip-compressed"]


class InstallProviderPluginFromDirectoryInput(BaseModel):
    path: str


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


def _ensure_community_installs_allowed(source_class: str) -> None:
    manager = get_provider_plugin_manager()
    is_blocked = (
        manager.is_install_blocked_by_policy(source_class)
        if hasattr(manager, "is_install_blocked_by_policy")
        else False
    )
    if is_blocked:
        raise ValueError("Community plugin installs are blocked in Safe mode")


def _to_import_response(plugin_id: str) -> ImportProviderPluginResponse:
    manager = get_provider_plugin_manager()
    manifest = manager.get_manifest(plugin_id)
    if manifest is None:
        raise RuntimeError(f"Provider plugin '{plugin_id}' not found after install")

    manager.enable_plugin(plugin_id, True)
    _ensure_provider_settings_initialized(
        manifest.provider,
        enabled=False,
        base_url=manifest.default_base_url,
    )

    plugin_info = manager.get_plugin_info(plugin_id)
    reload_provider_registry()
    return ImportProviderPluginResponse(
        id=manifest.id,
        provider=manifest.provider,
        name=manifest.name,
        version=manifest.version,
        verificationStatus=plugin_info.verification_status if plugin_info else "unsigned",
        verificationMessage=plugin_info.verification_message if plugin_info else None,
        signingKeyId=plugin_info.signing_key_id if plugin_info else None,
    )


@command
async def get_provider_plugin_policy() -> ProviderPluginPolicy:
    policy = get_provider_plugin_manager().get_policy()
    return ProviderPluginPolicy(
        mode=policy.mode,
        autoUpdateEnabled=policy.auto_update_enabled,
    )


@command
async def save_provider_plugin_policy(
    body: SaveProviderPluginPolicyInput,
) -> ProviderPluginPolicy:
    policy = get_provider_plugin_manager().save_policy(
        mode=body.mode,
        auto_update_enabled=body.autoUpdateEnabled,
    )
    reload_provider_registry()
    return ProviderPluginPolicy(
        mode=policy.mode,
        autoUpdateEnabled=policy.auto_update_enabled,
    )


@command
async def list_provider_plugin_indexes() -> ProviderPluginIndexesResponse:
    manager = get_provider_plugin_manager()
    indexes = manager.list_indexes()
    counts: dict[str, int] = {}
    for source in manager.list_sources():
        if source.index_id:
            counts[source.index_id] = counts.get(source.index_id, 0) + 1

    return ProviderPluginIndexesResponse(
        indexes=[
            ProviderPluginIndexInfo(
                id=item.id,
                name=item.name,
                url=item.url,
                sourceClass=item.source_class,
                builtIn=item.built_in,
                pluginCount=counts.get(item.id, 0),
            )
            for item in indexes
        ]
    )


@command
async def add_provider_plugin_index(
    body: AddProviderPluginIndexInput,
) -> ProviderPluginIndexInfo:
    manager = get_provider_plugin_manager()
    index = manager.add_index(name=body.name, url=body.url)
    return ProviderPluginIndexInfo(
        id=index.id,
        name=index.name,
        url=index.url,
        sourceClass=index.source_class,
        builtIn=index.built_in,
        pluginCount=manager.refresh_index(index.id),
    )


@command
async def remove_provider_plugin_index(
    body: RemoveProviderPluginIndexInput,
) -> dict[str, bool]:
    manager = get_provider_plugin_manager()
    if not manager.remove_index(body.id):
        raise ValueError(f"Provider plugin index '{body.id}' not found")
    return {"success": True}


@command
async def refresh_provider_plugin_index(
    body: RefreshProviderPluginIndexInput,
) -> dict[str, int | str]:
    manager = get_provider_plugin_manager()
    count = manager.refresh_index(body.id)
    return {"id": body.id, "pluginCount": count}


@command
async def list_provider_plugin_sources() -> ProviderPluginSourcesResponse:
    manager = get_provider_plugin_manager()
    installed_ids = {plugin.id for plugin in manager.list_plugins()}

    sources = []
    for source in manager.list_sources():
        blocked = manager.is_install_blocked_by_policy(source.source_class)
        is_installed = source.plugin_id in installed_ids or source.id in installed_ids
        sources.append(
            ProviderPluginSourceInfo(
                id=source.id,
                pluginId=source.plugin_id,
                name=source.name,
                version=source.version,
                provider=source.provider,
                description=source.description,
                icon=source.icon,
                sourceClass=source.source_class,
                indexId=source.index_id,
                indexName=source.index_name,
                sourceUrl=source.source_url,
                repoUrl=source.repo_url,
                trackingRef=source.tracking_ref,
                pluginPath=source.plugin_path,
                blockedByPolicy=blocked,
                installed=is_installed,
            )
        )

    return ProviderPluginSourcesResponse(sources=sources)


@command
async def install_provider_plugin_source(
    body: InstallProviderPluginSourceInput,
) -> ImportProviderPluginResponse:
    manager = get_provider_plugin_manager()
    source = manager.get_source(body.id)
    if source is None:
        raise ValueError(f"Unknown provider plugin source '{body.id}'")

    _ensure_community_installs_allowed(source.source_class)
    plugin_id = manager.install_source(body.id)
    logger.info("Installed provider plugin source '%s'", body.id)
    return _to_import_response(plugin_id)


@command
async def install_provider_plugin_from_repo(
    body: InstallProviderPluginFromRepoInput,
) -> ImportProviderPluginResponse:
    _ensure_community_installs_allowed("community")
    manager = get_provider_plugin_manager()
    plugin_id = manager.install_from_repo(
        repo_url=body.repoUrl,
        ref=body.ref,
        plugin_path=body.pluginPath,
        source_type="repo",
        source_ref=body.repoUrl,
        source_class="community",
        index_id=None,
    )
    logger.info("Installed provider plugin from repo %s", body.repoUrl)
    return _to_import_response(plugin_id)


@command
async def set_provider_plugin_auto_update(
    body: SetProviderPluginAutoUpdateInput,
) -> dict[str, bool | str]:
    manager = get_provider_plugin_manager()
    if not manager.set_auto_update(
        body.id,
        override=body.override,
        tracking_ref=body.trackingRef,
    ):
        raise ValueError(f"Provider plugin '{body.id}' not found")
    return {"success": True, "id": body.id, "override": body.override}


@command
async def run_provider_plugin_update_check() -> ProviderPluginUpdateCheckResponse:
    manager = get_provider_plugin_manager()
    raw_results = manager.run_update_check()
    reload_provider_registry()

    updated = sum(1 for item in raw_results if item.status == "updated")
    skipped = sum(1 for item in raw_results if item.status == "skipped")
    failed = sum(1 for item in raw_results if item.status == "failed")

    return ProviderPluginUpdateCheckResponse(
        results=[
            ProviderPluginUpdateItem(
                id=item.id,
                status=item.status,
                message=item.message,
            )
            for item in raw_results
        ],
        updated=updated,
        skipped=skipped,
        failed=failed,
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
            blockedByPolicy=item.blocked_by_policy,
            installedAt=item.installed_at,
            sourceType=item.source_type,
            sourceRef=item.source_ref,
            sourceClass=item.source_class,
            indexId=item.index_id,
            repoUrl=item.repo_url,
            trackingRef=item.tracking_ref,
            pluginPath=item.plugin_path,
            autoUpdateOverride=item.auto_update_override,
            effectiveAutoUpdate=item.effective_auto_update,
            description=item.description,
            icon=item.icon,
            authType=item.auth_type,
            defaultBaseUrl=item.default_base_url,
            defaultEnabled=item.default_enabled,
            oauthVariant=item.oauth_variant,
            oauthEnterpriseDomain=item.oauth_enterprise_domain,
            aliases=item.aliases,
            verificationStatus=item.verification_status,
            verificationMessage=item.verification_message,
            signingKeyId=item.signing_key_id,
            updateError=item.update_error,
            error=item.error,
        )
        for item in manager.list_plugins()
    ]
    return ProviderPluginsResponse(plugins=plugins)


@upload(max_size=MAX_PROVIDER_PLUGIN_SIZE, allowed_types=ALLOWED_PROVIDER_PLUGIN_TYPES)
async def import_provider_plugin(file: UploadFile) -> ImportProviderPluginResponse:
    _ensure_community_installs_allowed("community")
    manager = get_provider_plugin_manager()
    plugin_id = manager.import_from_zip(
        zip_data=await file.read(),
        source_type="zip",
        source_ref=file.filename,
        source_class="community",
    )

    logger.info("Imported provider plugin '%s' from %s", plugin_id, file.filename)
    return _to_import_response(plugin_id)


@command
async def import_provider_plugin_from_directory(
    body: InstallProviderPluginFromDirectoryInput,
) -> ImportProviderPluginResponse:
    _ensure_community_installs_allowed("community")
    manager = get_provider_plugin_manager()
    plugin_id = manager.import_from_directory(
        Path(body.path),
        source_type="local",
        source_ref=body.path,
        source_class="community",
    )

    logger.info("Imported provider plugin '%s' from directory %s", plugin_id, body.path)
    return _to_import_response(plugin_id)


@command
async def enable_provider_plugin(body: EnableProviderPluginInput) -> dict[str, bool]:
    manager = get_provider_plugin_manager()
    manifest = manager.get_manifest(body.id)
    if manifest is None:
        raise ValueError(f"Provider plugin '{body.id}' not found")

    plugin_info = manager.get_plugin_info(body.id)
    if body.enabled and plugin_info and plugin_info.blocked_by_policy:
        raise ValueError(f"Provider plugin '{body.id}' is blocked by Safe mode policy")

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
