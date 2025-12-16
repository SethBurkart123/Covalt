"""
MCP Server management endpoints.

Provides commands for managing MCP server connections:
- List servers with status and tools
- Add/update/remove servers
- Reconnect to failed servers
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel
from zynk import command

from ..services.mcp_manager import get_mcp_manager


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server."""

    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    cwd: Optional[str] = None
    url: Optional[str] = None
    transport: Optional[Literal["sse", "streamable-http"]] = None
    headers: Optional[Dict[str, str]] = None
    requiresConfirmation: bool = True
    toolOverrides: Optional[Dict[str, Dict[str, Any]]] = None


class MCPToolInfo(BaseModel):
    """Information about an MCP tool."""

    id: str
    name: str
    description: Optional[str] = None
    inputSchema: Optional[Dict[str, Any]] = None
    renderer: Optional[str] = None
    editable_args: Optional[List[str]] = None
    requires_confirmation: bool = True


class MCPServerInfo(BaseModel):
    """Information about an MCP server."""

    id: str
    status: Literal["connecting", "connected", "error", "disconnected"]
    error: Optional[str] = None
    toolCount: int = 0
    tools: List[MCPToolInfo] = []
    config: Dict[str, Any] = {}


class MCPServersResponse(BaseModel):
    """Response for get_mcp_servers."""

    servers: List[MCPServerInfo]


class AddMCPServerInput(BaseModel):
    """Input for adding a new MCP server."""

    id: str
    config: MCPServerConfig


class UpdateMCPServerInput(BaseModel):
    """Input for updating an MCP server."""

    id: str
    config: MCPServerConfig


class MCPServerId(BaseModel):
    """Input containing just a server ID."""

    id: str


@command
async def get_mcp_servers() -> MCPServersResponse:
    """
    Get all MCP servers with their status and tools.

    Returns list of servers including:
    - Connection status (connecting, connected, error, disconnected)
    - Error message if status is error
    - List of available tools for connected servers
    - Sanitized config (env vars hidden)
    """
    mcp = get_mcp_manager()

    servers = []
    for server_data in mcp.get_servers():
        server_id = server_data["id"]
        tools = [
            MCPToolInfo(
                id=t["id"],
                name=t["name"],
                description=t.get("description"),
                inputSchema=t.get("inputSchema"),
                renderer=t.get("renderer"),
                editable_args=t.get("editable_args"),
                requires_confirmation=t.get("requires_confirmation", True),
            )
            for t in mcp.get_server_tools(server_id)
        ]

        servers.append(
            MCPServerInfo(
                id=server_id,
                status=server_data["status"],
                error=server_data.get("error"),
                toolCount=server_data["toolCount"],
                tools=tools,
                config=server_data["config"],
            )
        )

    return MCPServersResponse(servers=servers)


@command
async def add_mcp_server(body: AddMCPServerInput) -> MCPServerInfo:
    """
    Add a new MCP server and connect to it.

    Args:
        body: Contains server ID and configuration

    Returns:
        Server info with connection status
    """
    mcp = get_mcp_manager()
    await mcp.add_server(body.id, body.config.model_dump(exclude_none=True))

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found after adding")

    tools = [
        MCPToolInfo(
            id=t["id"],
            name=t["name"],
            description=t.get("description"),
            inputSchema=t.get("inputSchema"),
            renderer=t.get("renderer"),
            editable_args=t.get("editable_args"),
            requires_confirmation=t.get("requires_confirmation", True),
        )
        for t in mcp.get_server_tools(body.id)
    ]

    return MCPServerInfo(
        id=body.id,
        status=server_data["status"],
        error=server_data.get("error"),
        toolCount=server_data["toolCount"],
        tools=tools,
        config=server_data["config"],
    )


@command
async def update_mcp_server(body: UpdateMCPServerInput) -> MCPServerInfo:
    """
    Update an MCP server configuration and reconnect.

    Args:
        body: Contains server ID and new configuration

    Returns:
        Server info with connection status
    """
    mcp = get_mcp_manager()
    await mcp.update_server(body.id, body.config.model_dump(exclude_none=True))

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found after updating")

    tools = [
        MCPToolInfo(
            id=t["id"],
            name=t["name"],
            description=t.get("description"),
            inputSchema=t.get("inputSchema"),
            renderer=t.get("renderer"),
            editable_args=t.get("editable_args"),
            requires_confirmation=t.get("requires_confirmation", True),
        )
        for t in mcp.get_server_tools(body.id)
    ]

    return MCPServerInfo(
        id=body.id,
        status=server_data["status"],
        error=server_data.get("error"),
        toolCount=server_data["toolCount"],
        tools=tools,
        config=server_data["config"],
    )


@command
async def remove_mcp_server(body: MCPServerId) -> Dict[str, bool]:
    """
    Disconnect and remove an MCP server.

    Args:
        body: Contains server ID

    Returns:
        Success status
    """
    mcp = get_mcp_manager()
    await mcp.remove_server(body.id)
    return {"success": True}


@command
async def reconnect_mcp_server(body: MCPServerId) -> MCPServerInfo:
    """
    Reconnect to a failed or disconnected MCP server.

    Args:
        body: Contains server ID

    Returns:
        Server info with new connection status
    """
    mcp = get_mcp_manager()
    await mcp.reconnect(body.id)

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found")

    tools = [
        MCPToolInfo(
            id=t["id"],
            name=t["name"],
            description=t.get("description"),
            inputSchema=t.get("inputSchema"),
            renderer=t.get("renderer"),
            editable_args=t.get("editable_args"),
            requires_confirmation=t.get("requires_confirmation", True),
        )
        for t in mcp.get_server_tools(body.id)
    ]

    return MCPServerInfo(
        id=body.id,
        status=server_data["status"],
        error=server_data.get("error"),
        toolCount=server_data["toolCount"],
        tools=tools,
        config=server_data["config"],
    )
