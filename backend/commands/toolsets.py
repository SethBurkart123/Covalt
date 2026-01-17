"""
Toolset management endpoints.

Provides commands for managing toolsets:
- List installed toolsets
- Import toolset from ZIP
- Export toolset to ZIP
- Enable/disable toolsets
- Uninstall toolsets
- Workspace file operations
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from ..services.mcp_manager import get_mcp_manager
from ..services.toolset_manager import get_toolset_manager
from ..services.workspace_manager import get_workspace_manager

logger = logging.getLogger(__name__)


# =============================================================================
# Request/Response Models
# =============================================================================


class ToolInfo(BaseModel):
    """Information about a tool."""

    tool_id: str
    name: str
    description: Optional[str] = None
    category: str = "utility"
    requires_confirmation: bool = False
    enabled: bool = True


class ToolsetInfo(BaseModel):
    """Information about a toolset."""

    id: str
    name: str
    version: str
    description: Optional[str] = None
    enabled: bool = True
    installed_at: Optional[str] = None
    source_type: Optional[str] = None
    tool_count: int = 0


class ToolsetDetailInfo(ToolsetInfo):
    """Detailed toolset information including tools."""

    tools: List[ToolInfo] = []


class ToolsetsResponse(BaseModel):
    """Response for list_toolsets."""

    toolsets: List[ToolsetInfo]


class ToolsetIdRequest(BaseModel):
    """Request containing just a toolset ID."""

    id: str


class EnableToolsetRequest(BaseModel):
    """Request to enable/disable a toolset."""

    id: str
    enabled: bool


class ImportToolsetResult(BaseModel):
    """Result of importing a toolset."""

    id: str
    name: str
    version: str
    tool_count: int


class ExportToolsetResponse(BaseModel):
    """Response containing exported toolset ZIP as base64."""

    filename: str
    data: str  # Base64 encoded ZIP


# Workspace models


class WorkspaceFileInfo(BaseModel):
    """Information about a file in the workspace."""

    path: str
    size: int


class WorkspaceFilesRequest(BaseModel):
    """Request for workspace file operations."""

    chat_id: str


class WorkspaceFilesResponse(BaseModel):
    """Response listing workspace files."""

    files: List[str]


class WorkspaceFileRequest(BaseModel):
    """Request for a specific workspace file."""

    chat_id: str
    path: str


class WorkspaceFileResponse(BaseModel):
    """Response with workspace file content."""

    path: str
    content: str  # Base64 encoded for binary safety
    size: int


class WorkspaceManifestRequest(BaseModel):
    """Request for workspace manifest."""

    chat_id: str
    manifest_id: Optional[str] = None  # None = active manifest


class WorkspaceManifestResponse(BaseModel):
    """Response with workspace manifest info."""

    id: str
    chat_id: str
    parent_id: Optional[str] = None
    files: Dict[str, str]  # path -> hash
    created_at: Optional[str] = None
    source: str


class UpdateWorkspaceFileRequest(BaseModel):
    """Request to update/create a file in the workspace."""

    chat_id: str
    path: str
    content: str  # Base64 encoded


class UpdateWorkspaceFileResponse(BaseModel):
    """Response after updating a workspace file."""

    manifest_id: str
    path: str


# =============================================================================
# Toolset Commands
# =============================================================================


@command
async def list_toolsets() -> ToolsetsResponse:
    """
    List all installed toolsets.

    Returns list of toolsets with their basic info.
    """
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
    """
    Get detailed information about a toolset including its tools.

    Args:
        body: Contains toolset ID

    Returns:
        Toolset info with list of tools
    """
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
                category=t.get("category", "utility"),
                requires_confirmation=t.get("requires_confirmation", False),
                enabled=t.get("enabled", True),
            )
            for t in toolset.get("tools", [])
        ],
    )


# 100MB max for toolset ZIP
MAX_TOOLSET_SIZE = "100MB"
ALLOWED_TOOLSET_TYPES = ["application/zip", "application/x-zip-compressed"]


@upload(max_size=MAX_TOOLSET_SIZE, allowed_types=ALLOWED_TOOLSET_TYPES)
async def import_toolset(file: UploadFile) -> ImportToolsetResult:
    """
    Import a toolset from a ZIP file upload.

    Args:
        file: Uploaded ZIP file

    Returns:
        Imported toolset info
    """
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

    # Reload MCP servers in case the toolset added any
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
    """
    Export a toolset to a ZIP file.

    Args:
        body: Contains toolset ID

    Returns:
        Base64 encoded ZIP file data
    """
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
    """
    Enable or disable a toolset.

    Args:
        body: Contains toolset ID and enabled state

    Returns:
        Success status
    """
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
    """
    Uninstall a toolset.

    Removes all database records and files for the toolset.

    Args:
        body: Contains toolset ID

    Returns:
        Success status
    """
    manager = get_toolset_manager()
    success = manager.uninstall(body.id)

    if not success:
        raise ValueError(f"Toolset '{body.id}' not found")

    return {"success": True}


# =============================================================================
# Workspace Commands
# =============================================================================


@command
async def get_workspace_files(body: WorkspaceFilesRequest) -> WorkspaceFilesResponse:
    """
    List all files in a chat's workspace.

    Args:
        body: Contains chat ID

    Returns:
        List of file paths
    """
    manager = get_workspace_manager(body.chat_id)
    files = manager.list_files()

    return WorkspaceFilesResponse(files=files)


@command
async def get_workspace_file(body: WorkspaceFileRequest) -> WorkspaceFileResponse:
    """
    Read a file from a chat's workspace.

    Args:
        body: Contains chat ID and file path

    Returns:
        File content (base64 encoded)
    """
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
    """
    Get a workspace manifest for a chat.

    Args:
        body: Contains chat ID and optional manifest ID

    Returns:
        Manifest info including file mappings
    """
    manager = get_workspace_manager(body.chat_id)

    manifest_id = body.manifest_id
    if manifest_id is None:
        manifest_id = manager.get_active_manifest_id()

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


@command
async def update_workspace_file(
    body: UpdateWorkspaceFileRequest,
) -> UpdateWorkspaceFileResponse:
    """
    Update or create a file in a chat's workspace.

    Creates a new manifest with source="edit" and updates the chat's
    active_manifest_id. The file is written to the workspace directory
    and stored in blob storage.

    Args:
        body: Contains chat ID, file path, and base64-encoded content

    Returns:
        New manifest ID and the file path
    """
    manager = get_workspace_manager(body.chat_id)

    # Decode base64 content
    try:
        content = base64.b64decode(body.content)
    except Exception as e:
        raise ValueError(f"Invalid base64 content: {e}")

    # Check file size (5MB limit for editable files)
    max_size = 5 * 1024 * 1024  # 5MB
    if len(content) > max_size:
        raise ValueError(f"File too large: {len(content)} bytes (max {max_size})")

    # Add/update the file in workspace, creating a new manifest
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

    # Broadcast file change to connected clients
    try:
        import asyncio
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
