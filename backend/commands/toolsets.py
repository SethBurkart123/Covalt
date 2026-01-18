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
    installed_at: Optional[str] = None
    source_type: Optional[str] = None
    tool_count: int = 0


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
async def list_toolsets() -> ToolsetsResponse:
    manager = get_toolset_manager()
    toolsets = manager.list_toolsets()

    return ToolsetsResponse(
        toolsets=[
            ToolsetInfo(
                id=t["id"],
                name=t["name"],
                version=t["version"],
                description=t.get("description"),
                enabled=t["enabled"],
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
    content = await file.read()
    manager = get_toolset_manager()

    toolset_id = manager.import_from_zip(
        zip_data=content,
        source_type="zip",
        source_ref=file.filename,
    )

    toolset = manager.get_toolset(toolset_id)
    if toolset is None:
        raise RuntimeError(f"Toolset '{toolset_id}' not found after import")

    mcp_manager = get_mcp_manager()
    new_servers = await mcp_manager.reload_from_db()
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

    zip_data = manager.export_to_zip(body.id)
    filename = f"{body.id}-v{toolset['version']}.zip"

    return ExportToolsetResponse(
        filename=filename,
        data=base64.b64encode(zip_data).decode("ascii"),
    )


@command
async def enable_toolset(body: EnableToolsetRequest) -> Dict[str, Any]:
    manager = get_toolset_manager()
    success = manager.enable_toolset(body.id, body.enabled)

    if not success:
        raise ValueError(f"Toolset '{body.id}' not found")

    mcp_manager = get_mcp_manager()
    if body.enabled:
        await mcp_manager.reload_from_db()
    else:
        await mcp_manager.disconnect_toolset_servers(body.id)

    return {"success": True, "enabled": body.enabled}


@command
async def uninstall_toolset(body: ToolsetIdRequest) -> Dict[str, bool]:
    manager = get_toolset_manager()
    success = manager.uninstall(body.id)

    if not success:
        raise ValueError(f"Toolset '{body.id}' not found")

    return {"success": True}


@command
async def get_workspace_files(body: WorkspaceFilesRequest) -> WorkspaceFilesResponse:
    manager = get_workspace_manager(body.chat_id)
    files = manager.list_files()

    return WorkspaceFilesResponse(files=files)


@command
async def get_workspace_file(body: WorkspaceFileRequest) -> WorkspaceFileResponse:
    manager = get_workspace_manager(body.chat_id)
    content = manager.read_file(body.path)

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
    manager = get_workspace_manager(body.chat_id)

    try:
        content = base64.b64decode(body.content)
    except Exception as e:
        raise ValueError(f"Invalid base64 content: {e}")

    if len(content) > MAX_EDITABLE_FILE_SIZE:
        raise ValueError(
            f"File too large: {len(content)} bytes (max {MAX_EDITABLE_FILE_SIZE})"
        )

    manifest_id = manager.add_file(
        rel_path=body.path,
        content=content,
        source="edit",
        source_ref=None,
    )

    logger.info(
        f"Updated workspace file '{body.path}' in chat {body.chat_id[:8]}..., "
        f"new manifest {manifest_id[:8]}..."
    )

    try:
        from .events import broadcast_workspace_files_changed

        asyncio.create_task(
            broadcast_workspace_files_changed(body.chat_id, [body.path], [])
        )
    except Exception as e:
        logger.debug(f"Failed to broadcast workspace change: {e}")

    return UpdateWorkspaceFileResponse(
        manifest_id=manifest_id,
        path=body.path,
    )
