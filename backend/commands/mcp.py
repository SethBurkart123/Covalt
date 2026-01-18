"""
MCP Server management endpoints.

Provides commands for managing MCP server connections:
- List servers with status and tools
- Add/update/remove servers
- Reconnect to failed servers
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel
from zynk import command

from ..services.mcp_manager import get_mcp_manager
from ..services.toolset_manager import get_toolset_manager


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
    renderer_config: Optional[Dict[str, Any]] = None
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
                renderer_config=t.get("renderer_config"),
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

    This creates a user_mcp toolset to wrap the MCP server,
    then adds the server to that toolset.

    Args:
        body: Contains server ID and configuration

    Returns:
        Server info with connection status
    """
    toolset_manager = get_toolset_manager()
    toolset_manager.create_user_mcp_toolset(body.id)

    mcp = get_mcp_manager()
    await mcp.add_server(
        body.id, body.config.model_dump(exclude_none=True), toolset_id=body.id
    )

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
            renderer_config=t.get("renderer_config"),
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

    This also removes the associated user_mcp toolset.

    Args:
        body: Contains server ID

    Returns:
        Success status
    """
    mcp = get_mcp_manager()
    await mcp.remove_server(body.id)

    toolset_manager = get_toolset_manager()
    toolset_manager.uninstall(body.id)

    return {"success": True}


@command
async def get_mcp_server_config(body: MCPServerId) -> Dict[str, Any]:
    """
    Get a single MCP server's configuration for editing.

    Returns unsanitized config with actual environment variable values.

    Args:
        body: Contains server ID

    Returns:
        Server configuration dict
    """
    mcp = get_mcp_manager()
    config = mcp.get_server_config(body.id, sanitize=False)
    if config is None:
        raise ValueError(f"Server {body.id} not found")
    return config


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
            renderer_config=t.get("renderer_config"),
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


class ScannedServer(BaseModel):
    id: str
    config: MCPServerConfig


class SourceScanResult(BaseModel):
    servers: List[ScannedServer]
    error: Optional[str] = None


class ScanImportSourcesResponse(BaseModel):
    results: Dict[str, SourceScanResult]


# Source configurations with paths for each OS
IMPORT_SOURCE_CONFIGS: Dict[str, Dict[str, Any]] = {
    "claude-desktop": {
        "paths": {
            "darwin": [
                "~/Library/Application Support/Claude/claude_desktop_config.json"
            ],
            "win32": ["%APPDATA%\\Claude\\claude_desktop_config.json"],
            "linux": ["~/.config/Claude/claude_desktop_config.json"],
        },
        "root_key": "mcpServers",
    },
    "claude-code": {
        "paths": {
            "darwin": ["~/.claude.json"],
            "win32": ["%USERPROFILE%\\.claude.json"],
            "linux": ["~/.claude.json"],
        },
        "root_key": "mcpServers",
    },
    "opencode": {
        "paths": {
            "darwin": ["~/.config/opencode/opencode.json"],
            "win32": ["%APPDATA%\\opencode\\opencode.json"],
            "linux": ["~/.config/opencode/opencode.json"],
        },
        "root_key": "mcp",
    },
    "cursor": {
        "paths": {
            "darwin": ["~/.cursor/mcp.json"],
            "win32": ["%USERPROFILE%\\.cursor\\mcp.json"],
            "linux": ["~/.cursor/mcp.json"],
        },
        "root_key": "mcpServers",
    },
}


def _expand_path(path: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(path)))


def _parse_claude_desktop_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    if "command" in raw:
        config["command"] = raw["command"]
    if "args" in raw:
        config["args"] = raw["args"]
    if "cwd" in raw:
        config["cwd"] = raw["cwd"]
    if "env" in raw:
        config["env"] = raw["env"]

    return config


def _parse_claude_code_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    server_type = raw.get("type", "stdio")

    if server_type == "stdio":
        if "command" in raw:
            config["command"] = raw["command"]
        if "args" in raw:
            config["args"] = raw["args"]
        if "cwd" in raw:
            config["cwd"] = raw["cwd"]
    else:
        if "url" in raw:
            config["url"] = raw["url"]
            config["transport"] = "sse"

    if "env" in raw:
        config["env"] = raw["env"]

    return config


def _parse_opencode_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    server_type = raw.get("type", "local")

    if server_type == "remote":
        if "url" in raw:
            config["url"] = raw["url"]
            config["transport"] = "sse"
    else:
        cmd = raw.get("command", [])
        if isinstance(cmd, list) and len(cmd) > 0:
            config["command"] = cmd[0]
            if len(cmd) > 1:
                config["args"] = cmd[1:]

    if "environment" in raw:
        config["env"] = raw["environment"]

    return config


def _parse_cursor_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    if "url" in raw:
        config["url"] = raw["url"]
        config["transport"] = "sse"
    else:
        if "command" in raw:
            config["command"] = raw["command"]
        if "args" in raw:
            config["args"] = raw["args"]
        if "cwd" in raw:
            config["cwd"] = raw["cwd"]

    if "env" in raw:
        config["env"] = raw["env"]

    return config


def _scan_source(source_key: str) -> SourceScanResult:
    source_config = IMPORT_SOURCE_CONFIGS.get(source_key)
    if not source_config:
        return SourceScanResult(servers=[], error=f"Unknown source: {source_key}")

    paths = source_config["paths"].get(sys.platform, [])
    root_key = source_config["root_key"]

    parsers = {
        "claude-desktop": _parse_claude_desktop_server,
        "claude-code": _parse_claude_code_server,
        "opencode": _parse_opencode_server,
        "cursor": _parse_cursor_server,
    }
    parser = parsers.get(source_key)
    if not parser:
        return SourceScanResult(servers=[], error=f"Unknown source: {source_key}")

    for path_str in paths:
        path = _expand_path(path_str)
        if not path.exists():
            continue

        try:
            data = json.loads(path.read_text(encoding="utf-8"))

            servers_data = data.get(root_key, {})
            if not isinstance(servers_data, dict):
                continue

            servers: List[ScannedServer] = []
            for server_id, raw_config in servers_data.items():
                if not isinstance(raw_config, dict):
                    continue

                servers.append(ScannedServer(id=server_id, config=parser(raw_config)))

            return SourceScanResult(servers=servers, error=None)

        except json.JSONDecodeError as e:
            return SourceScanResult(servers=[], error=f"Invalid JSON: {e}")
        except Exception as e:
            return SourceScanResult(servers=[], error=str(e))

    return SourceScanResult(servers=[], error="Config file not found")


@command
async def scan_import_sources() -> ScanImportSourcesResponse:
    """
    Scan external app config files for MCP servers to import.
    """
    results: Dict[str, SourceScanResult] = {}

    for source_key in IMPORT_SOURCE_CONFIGS.keys():
        results[source_key] = _scan_source(source_key)

    return ScanImportSourcesResponse(results=results)
