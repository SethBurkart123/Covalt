from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from ..services.mcp_manager import get_mcp_manager
from ..services.toolset_manager import get_toolset_manager
from ..services.workspace_manager import get_workspace_manager

logger = logging.getLogger(__name__)


class ToolInfo(BaseModel):
    tool_id: str
    name: str
    description: Optional[str] = None
    requires_confirmation: bool = False
    enabled: bool = True


class ToolsetInfo(BaseModel):
    id: str
    name: str
    version: str
    description: Optional[str] = None
    enabled: bool = True
    user_mcp: bool = False
    installed_at: Optional[str] = None
    source_type: Optional[str] = None
    tool_count: int = 0


class ListToolsetsRequest(BaseModel):
    user_mcp: Optional[bool] = None


class ToolsetDetailInfo(ToolsetInfo):
    tools: List[ToolInfo] = []


class ToolsetsResponse(BaseModel):
    toolsets: List[ToolsetInfo]


class ToolsetIdRequest(BaseModel):
    id: str


class EnableToolsetRequest(BaseModel):
    id: str
    enabled: bool


class ImportToolsetResult(BaseModel):
    id: str
    name: str
    version: str
    tool_count: int


class ExportToolsetResponse(BaseModel):
    filename: str
    data: str


class WorkspaceFileInfo(BaseModel):
    path: str
    size: int


class WorkspaceFilesRequest(BaseModel):
    chat_id: str


class WorkspaceFilesResponse(BaseModel):
    files: List[str]


class WorkspaceFileRequest(BaseModel):
    chat_id: str
    path: str


class WorkspaceFileResponse(BaseModel):
    path: str
    content: str
    size: int


class WorkspaceManifestRequest(BaseModel):
    chat_id: str
    manifest_id: Optional[str] = None


class WorkspaceManifestResponse(BaseModel):
    id: str
    chat_id: str
    parent_id: Optional[str] = None
    files: Dict[str, str]
    created_at: Optional[str] = None
    source: str


class UpdateWorkspaceFileRequest(BaseModel):
    chat_id: str
    path: str
    content: str


class UpdateWorkspaceFileResponse(BaseModel):
    manifest_id: str
    path: str


@command
async def list_toolsets(body: Optional[ListToolsetsRequest] = None) -> ToolsetsResponse:
    manager = get_toolset_manager()
    toolsets = manager.list_toolsets(user_mcp=body.user_mcp if body else None)

    return ToolsetsResponse(
        toolsets=[
            ToolsetInfo(
                id=t["id"],
                name=t["name"],
                version=t["version"],
                description=t.get("description"),
                enabled=t["enabled"],
                user_mcp=t.get("user_mcp", False),
                installed_at=t.get("installed_at"),
                source_type=t.get("source_type"),
                tool_count=0,
            )
            for t in toolsets
        ]
    )


@command
async def get_toolset(body: ToolsetIdRequest) -> ToolsetDetailInfo:
    manager = get_toolset_manager()
    toolset = manager.get_toolset(body.id)

    if toolset is None:
        raise ValueError(f"Toolset '{body.id}' not found")

    return ToolsetDetailInfo(
        id=toolset["id"],
        name=toolset["name"],
        version=toolset["version"],
        description=toolset.get("description"),
        enabled=toolset["enabled"],
        installed_at=toolset.get("installed_at"),
        source_type=toolset.get("source_type"),
        tool_count=len(toolset.get("tools", [])),
        tools=[
            ToolInfo(
                tool_id=t["tool_id"],
                name=t["name"],
                description=t.get("description"),
                requires_confirmation=t.get("requires_confirmation", False),
                enabled=t.get("enabled", True),
            )
            for t in toolset.get("tools", [])
        ],
    )


MAX_TOOLSET_SIZE = "100MB"
ALLOWED_TOOLSET_TYPES = ["application/zip", "application/x-zip-compressed"]


@upload(max_size=MAX_TOOLSET_SIZE, allowed_types=ALLOWED_TOOLSET_TYPES)
async def import_toolset(file: UploadFile) -> ImportToolsetResult:
    manager = get_toolset_manager()
    toolset_id = manager.import_from_zip(
        zip_data=await file.read(), source_type="zip", source_ref=file.filename
    )

    toolset = manager.get_toolset(toolset_id)
    if toolset is None:
        raise RuntimeError(f"Toolset '{toolset_id}' not found after import")

    new_servers = await get_mcp_manager().reload_from_db()
    if new_servers:
        logger.info(f"Started {len(new_servers)} MCP server(s) from toolset")
    logger.info(f"Imported toolset '{toolset_id}' from {file.filename}")

    return ImportToolsetResult(
        id=toolset["id"],
        name=toolset["name"],
        version=toolset["version"],
        tool_count=len(toolset.get("tools", [])),
    )


@command
async def export_toolset(body: ToolsetIdRequest) -> ExportToolsetResponse:
    manager = get_toolset_manager()
    toolset = manager.get_toolset(body.id)
    if toolset is None:
        raise ValueError(f"Toolset '{body.id}' not found")

    return ExportToolsetResponse(
        filename=f"{body.id}-v{toolset['version']}.zip",
        data=base64.b64encode(manager.export_to_zip(body.id)).decode("ascii"),
    )


@command
async def enable_toolset(body: EnableToolsetRequest) -> Dict[str, Any]:
    if not get_toolset_manager().enable_toolset(body.id, body.enabled):
        raise ValueError(f"Toolset '{body.id}' not found")

    mcp_manager = get_mcp_manager()
    if body.enabled:
        await mcp_manager.reload_from_db()
    else:
        await mcp_manager.disconnect_toolset_servers(body.id)

    return {"success": True, "enabled": body.enabled}


@command
async def uninstall_toolset(body: ToolsetIdRequest) -> Dict[str, bool]:
    if not get_toolset_manager().uninstall(body.id):
        raise ValueError(f"Toolset '{body.id}' not found")
    return {"success": True}


@command
async def get_workspace_files(body: WorkspaceFilesRequest) -> WorkspaceFilesResponse:
    return WorkspaceFilesResponse(
        files=get_workspace_manager(body.chat_id).list_files()
    )


@command
async def get_workspace_file(body: WorkspaceFileRequest) -> WorkspaceFileResponse:
    content = get_workspace_manager(body.chat_id).read_file(body.path)
    if content is None:
        raise ValueError(f"File '{body.path}' not found in workspace")

    return WorkspaceFileResponse(
        path=body.path,
        content=base64.b64encode(content).decode("ascii"),
        size=len(content),
    )


@command
async def get_workspace_manifest(
    body: WorkspaceManifestRequest,
) -> WorkspaceManifestResponse:
    manager = get_workspace_manager(body.chat_id)
    manifest_id = body.manifest_id or manager.get_active_manifest_id()
    if manifest_id is None:
        raise ValueError("No active manifest for this chat")

    manifest = manager.get_manifest(manifest_id)
    if manifest is None:
        raise ValueError(f"Manifest '{manifest_id}' not found")

    return WorkspaceManifestResponse(
        id=manifest["id"],
        chat_id=manifest["chat_id"],
        parent_id=manifest.get("parent_id"),
        files=manifest["files"],
        created_at=manifest.get("created_at"),
        source=manifest["source"],
    )


MAX_EDITABLE_FILE_SIZE = 5 * 1024 * 1024


@command
async def update_workspace_file(
    body: UpdateWorkspaceFileRequest,
) -> UpdateWorkspaceFileResponse:
    try:
        content = base64.b64decode(body.content)
    except Exception as e:
        raise ValueError(f"Invalid base64 content: {e}")

    if len(content) > MAX_EDITABLE_FILE_SIZE:
        raise ValueError(
            f"File too large: {len(content)} bytes (max {MAX_EDITABLE_FILE_SIZE})"
        )

    manifest_id = get_workspace_manager(body.chat_id).add_file(
        rel_path=body.path, content=content, source="edit", source_ref=None
    )
    logger.info(
        f"Updated workspace file '{body.path}' in chat {body.chat_id[:8]}..., new manifest {manifest_id[:8]}..."
    )

    try:
        from .events import broadcast_workspace_files_changed

        asyncio.create_task(
            broadcast_workspace_files_changed(body.chat_id, [body.path], [])
        )
    except Exception as e:
        logger.debug(f"Failed to broadcast workspace change: {e}")

    return UpdateWorkspaceFileResponse(manifest_id=manifest_id, path=body.path)


class SetToolOverrideRequest(BaseModel):
    """Request to set/update a tool override."""

    toolset_id: str
    tool_id: str  # e.g., "perplexity:search" for MCP or "my-toolset:my-tool" for Python
    renderer: Optional[str] = None
    renderer_config: Optional[Dict[str, Any]] = None
    name_override: Optional[str] = None
    description_override: Optional[str] = None
    requires_confirmation: Optional[bool] = None
    enabled: Optional[bool] = None


class ToolOverrideResponse(BaseModel):
    """Response after setting a tool override."""

    toolset_id: str
    tool_id: str
    renderer: Optional[str] = None
    renderer_config: Optional[Dict[str, Any]] = None
    name_override: Optional[str] = None
    description_override: Optional[str] = None
    requires_confirmation: Optional[bool] = None
    enabled: bool = True


@command
async def set_tool_override(body: SetToolOverrideRequest) -> ToolOverrideResponse:
    import json
    import uuid
    from ..db import db_session
    from ..db.models import ToolOverride, Toolset

    with db_session() as sess:
        if not sess.query(Toolset).filter(Toolset.id == body.toolset_id).first():
            raise ValueError(f"Toolset '{body.toolset_id}' not found")

        existing = (
            sess.query(ToolOverride)
            .filter(
                ToolOverride.toolset_id == body.toolset_id,
                ToolOverride.tool_id == body.tool_id,
            )
            .first()
        )

        if existing:
            if body.renderer is not None:
                existing.renderer = body.renderer
            if body.renderer_config is not None:
                existing.renderer_config = json.dumps(body.renderer_config)
            if body.name_override is not None:
                existing.name_override = body.name_override
            if body.description_override is not None:
                existing.description_override = body.description_override
            if body.requires_confirmation is not None:
                existing.requires_confirmation = body.requires_confirmation
            if body.enabled is not None:
                existing.enabled = body.enabled
            override = existing
        else:
            override = ToolOverride(
                id=str(uuid.uuid4()),
                toolset_id=body.toolset_id,
                tool_id=body.tool_id,
                renderer=body.renderer,
                renderer_config=json.dumps(body.renderer_config)
                if body.renderer_config
                else None,
                name_override=body.name_override,
                description_override=body.description_override,
                requires_confirmation=body.requires_confirmation,
                enabled=body.enabled if body.enabled is not None else True,
            )
            sess.add(override)

        sess.commit()
        sess.refresh(override)

        return ToolOverrideResponse(
            toolset_id=override.toolset_id,
            tool_id=override.tool_id,
            renderer=override.renderer,
            renderer_config=json.loads(override.renderer_config)
            if override.renderer_config
            else None,
            name_override=override.name_override,
            description_override=override.description_override,
            requires_confirmation=override.requires_confirmation,
            enabled=override.enabled,
        )
