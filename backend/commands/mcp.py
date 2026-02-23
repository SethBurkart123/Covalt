from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import httpx
from pydantic import BaseModel, Field
from zynk import command

from ..services.mcp_manager import get_mcp_manager
from ..services.oauth_manager import get_oauth_manager
from ..services.toolset_manager import get_toolset_manager


class MCPServerConfig(BaseModel):
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
    id: str
    name: str
    description: Optional[str] = None
    inputSchema: Optional[Dict[str, Any]] = None
    renderer: Optional[str] = None
    renderer_config: Optional[Dict[str, Any]] = None
    requires_confirmation: bool = True


class MCPServerInfo(BaseModel):
    id: str
    status: Literal["connecting", "connected", "error", "disconnected", "requires_auth"]
    error: Optional[str] = None
    toolCount: int = 0
    tools: List[MCPToolInfo] = Field(default_factory=list)
    config: Dict[str, Any] = Field(default_factory=dict)


class MCPServersResponse(BaseModel):
    servers: List[MCPServerInfo]


def _tool_info(t: Dict[str, Any]) -> MCPToolInfo:
    return MCPToolInfo(
        id=t["id"],
        name=t["name"],
        description=t.get("description"),
        inputSchema=t.get("inputSchema"),
        renderer=t.get("renderer"),
        renderer_config=t.get("renderer_config"),
        requires_confirmation=t.get("requires_confirmation", True),
    )


def _server_info(mcp: Any, server_data: Dict[str, Any]) -> MCPServerInfo:
    server_id = server_data["id"]
    tools = [_tool_info(t) for t in mcp.get_server_tools(server_id)]
    return MCPServerInfo(
        id=server_id,
        status=server_data["status"],
        error=server_data.get("error"),
        toolCount=server_data["toolCount"],
        tools=tools,
        config=server_data["config"],
    )


class AddMCPServerInput(BaseModel):
    id: str
    config: MCPServerConfig


class UpdateMCPServerInput(BaseModel):
    id: str
    config: MCPServerConfig


class MCPServerId(BaseModel):
    id: str


@command
async def get_mcp_servers() -> MCPServersResponse:
    mcp = get_mcp_manager()
    return MCPServersResponse(
        servers=[_server_info(mcp, server_data) for server_data in mcp.get_servers()]
    )


@command
async def add_mcp_server(body: AddMCPServerInput) -> MCPServerInfo:
    get_toolset_manager().create_user_mcp_toolset(body.id)

    mcp = get_mcp_manager()
    await mcp.add_server(
        body.id, body.config.model_dump(exclude_none=True), toolset_id=body.id
    )

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found after adding")

    return _server_info(mcp, server_data)


@command
async def update_mcp_server(body: UpdateMCPServerInput) -> MCPServerInfo:
    mcp = get_mcp_manager()
    await mcp.update_server(body.id, body.config.model_dump(exclude_none=True))

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found after updating")

    return _server_info(mcp, server_data)


@command
async def remove_mcp_server(body: MCPServerId) -> Dict[str, bool]:
    await get_mcp_manager().remove_server(body.id)
    get_toolset_manager().uninstall(body.id)
    return {"success": True}


@command
async def get_mcp_server_config(body: MCPServerId) -> Dict[str, Any]:
    config = get_mcp_manager().get_server_config(body.id, sanitize=False)
    if config is None:
        raise ValueError(f"Server {body.id} not found")
    return config


@command
async def reconnect_mcp_server(body: MCPServerId) -> MCPServerInfo:
    mcp = get_mcp_manager()
    await mcp.reconnect(body.id)

    server_data = next((s for s in mcp.get_servers() if s["id"] == body.id), None)
    if not server_data:
        raise RuntimeError(f"Server {body.id} not found")

    return _server_info(mcp, server_data)


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


def _detect_mcp_transport(
    url: str, timeout: float = 5.0
) -> Literal["sse", "streamable-http"]:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "covalt-probe", "version": "1.0.0"},
        },
    }

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        try:
            response = client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            content_type = response.headers.get("content-type", "").lower()
            if response.status_code == 200 and (
                "application/json" in content_type
                or "text/event-stream" in content_type
            ):
                return "streamable-http"
            if response.status_code == 405:
                return "sse"
        except httpx.HTTPError:
            pass

    return "sse"


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
            url = raw["url"]
            config["url"] = url
            config["transport"] = _detect_mcp_transport(url)

    if "env" in raw:
        config["env"] = raw["env"]

    return config


def _parse_opencode_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    if raw.get("type", "local") == "remote":
        if "url" in raw:
            config["url"] = raw["url"]
            config["transport"] = _detect_mcp_transport(raw["url"])
    else:
        cmd = raw.get("command", [])
        if isinstance(cmd, list) and cmd:
            config["command"] = cmd[0]
            if len(cmd) > 1:
                config["args"] = cmd[1:]

    if "environment" in raw:
        config["env"] = raw["environment"]

    return config


def _parse_cursor_server(raw: Dict[str, Any]) -> Dict[str, Any]:
    config: Dict[str, Any] = {"requiresConfirmation": True}

    if "url" in raw:
        url = raw["url"]
        config["url"] = url
        config["transport"] = _detect_mcp_transport(url)
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

    parsers = {
        "claude-desktop": _parse_claude_desktop_server,
        "claude-code": _parse_claude_code_server,
        "opencode": _parse_opencode_server,
        "cursor": _parse_cursor_server,
    }
    parser = parsers.get(source_key)
    if not parser:
        return SourceScanResult(servers=[], error=f"Unknown source: {source_key}")

    paths = source_config["paths"].get(sys.platform, [])

    root_key = source_config["root_key"]
    for path_str in paths:
        path = _expand_path(path_str)
        if not path.exists():
            continue

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            servers_data = data.get(root_key, {})
            if not isinstance(servers_data, dict):
                continue

            servers = [
                ScannedServer(
                    id=server_id, config=MCPServerConfig(**parser(raw_config))
                )
                for server_id, raw_config in servers_data.items()
                if isinstance(raw_config, dict)
            ]

            return SourceScanResult(servers=servers, error=None)

        except json.JSONDecodeError as e:
            return SourceScanResult(servers=[], error=f"Invalid JSON: {e}")
        except Exception as e:
            return SourceScanResult(servers=[], error=str(e))

    return SourceScanResult(servers=[], error="Config file not found")


@command
async def scan_import_sources() -> ScanImportSourcesResponse:
    return ScanImportSourcesResponse(
        results={key: _scan_source(key) for key in IMPORT_SOURCE_CONFIGS.keys()}
    )


class TestMCPToolInput(BaseModel):
    serverId: str
    toolName: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class TestMCPToolResult(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None
    durationMs: int = 0


@command
async def test_mcp_tool(body: TestMCPToolInput) -> TestMCPToolResult:
    start = time.perf_counter()
    try:
        result = await get_mcp_manager().call_tool(
            body.serverId, body.toolName, body.arguments
        )
        return TestMCPToolResult(
            success=True,
            result=result,
            durationMs=int((time.perf_counter() - start) * 1000),
        )
    except Exception as e:
        return TestMCPToolResult(
            success=False,
            error=str(e),
            durationMs=int((time.perf_counter() - start) * 1000),
        )


class ProbeOAuthInput(BaseModel):
    url: str


class ProbeOAuthResult(BaseModel):
    requiresOAuth: bool
    providerName: Optional[str] = None
    resourceMetadataUrl: Optional[str] = None
    error: Optional[str] = None


@command
async def probe_mcp_oauth(body: ProbeOAuthInput) -> ProbeOAuthResult:
    result = await get_oauth_manager().probe_oauth_requirement(body.url)
    return ProbeOAuthResult(
        requiresOAuth=result.get("requiresOAuth", False),
        providerName=result.get("providerName"),
        resourceMetadataUrl=result.get("resourceMetadataUrl"),
        error=result.get("error"),
    )


class StartOAuthInput(BaseModel):
    serverId: str
    serverUrl: str
    callbackPort: int = 3000


class StartOAuthResult(BaseModel):
    success: bool
    authUrl: Optional[str] = None
    state: Optional[str] = None
    error: Optional[str] = None


@command
async def start_mcp_oauth(body: StartOAuthInput) -> StartOAuthResult:
    try:
        result = await get_oauth_manager().start_oauth_flow(
            server_id=body.serverId,
            server_url=body.serverUrl,
            callback_port=body.callbackPort,
        )
        return StartOAuthResult(
            success=True,
            authUrl=result.get("authUrl"),
            state=result.get("state"),
        )
    except Exception as e:
        return StartOAuthResult(success=False, error=str(e))


class OAuthStatusResult(BaseModel):
    status: Literal["none", "pending", "authenticated", "error"]
    hasTokens: bool = False
    error: Optional[str] = None


@command
async def get_mcp_oauth_status(body: MCPServerId) -> OAuthStatusResult:
    result = get_oauth_manager().get_oauth_status(body.id)
    return OAuthStatusResult(
        status=result.get("status", "none"),
        hasTokens=result.get("hasTokens", False),
        error=result.get("error"),
    )


class RevokeOAuthResult(BaseModel):
    success: bool
    error: Optional[str] = None


@command
async def revoke_mcp_oauth(body: MCPServerId) -> RevokeOAuthResult:
    try:
        await get_oauth_manager().revoke_oauth(body.id)
        return RevokeOAuthResult(success=True)
    except Exception as e:
        return RevokeOAuthResult(success=False, error=str(e))


class OAuthCallbackInput(BaseModel):
    code: str
    state: str


class OAuthCallbackErrorInput(BaseModel):
    state: str
    error: str
    errorDescription: Optional[str] = None


class OAuthCallbackResult(BaseModel):
    success: bool
    error: Optional[str] = None


@command
async def complete_mcp_oauth_callback(body: OAuthCallbackInput) -> OAuthCallbackResult:
    found = get_oauth_manager().complete_oauth_callback(body.code, body.state)
    return OAuthCallbackResult(
        success=found,
        error=None if found else "No pending OAuth flow found for this state",
    )


@command
async def fail_mcp_oauth_callback(body: OAuthCallbackErrorInput) -> OAuthCallbackResult:
    found = get_oauth_manager().fail_oauth_callback(
        body.state, body.error, body.errorDescription
    )
    return OAuthCallbackResult(
        success=found,
        error=None if found else "No pending OAuth flow found for this state",
    )
