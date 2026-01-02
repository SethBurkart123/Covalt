"""
MCP Server Manager - handles connections to MCP servers.

Connects eagerly on startup, maintains persistent sessions,
and provides tools as agno-compatible Function objects.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from agno.tools.function import Function
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Tool as MCPTool

from ..db import db_session
from ..db.models import McpServer

logger = logging.getLogger(__name__)

ServerStatus = Literal["connecting", "connected", "error", "disconnected"]


def _extract_error_message(e: BaseException) -> str:
    """Extract a useful error message, unwrapping ExceptionGroups if needed."""
    if isinstance(e, BaseExceptionGroup):
        messages = [_extract_error_message(exc) for exc in e.exceptions]
        return "; ".join(messages)
    return str(e)


StatusCallback = Callable[[str, ServerStatus, str | None, int], None]


@dataclass
class MCPServerState:
    """State for a single MCP server connection."""

    id: str
    server_type: str
    enabled: bool = True
    command: str | None = None
    args: list[str] | None = None
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    env: dict[str, str] | None = None
    requires_confirmation: bool = True
    tool_overrides: dict[str, Any] | None = None
    status: ServerStatus = "disconnected"
    error: str | None = None
    tools: list[MCPTool] = field(default_factory=list)
    session: ClientSession | None = None
    _cleanup_task: asyncio.Task | None = None
    _connection_event: asyncio.Event = field(default_factory=asyncio.Event)


def _db_row_to_state(row: McpServer) -> MCPServerState:
    """Convert a database row to MCPServerState."""
    return MCPServerState(
        id=row.id,
        server_type=row.server_type,
        enabled=row.enabled,
        command=row.command,
        args=json.loads(row.args) if row.args else None,
        cwd=row.cwd,
        url=row.url,
        headers=json.loads(row.headers) if row.headers else None,
        env=json.loads(row.env) if row.env else None,
        requires_confirmation=row.requires_confirmation,
        tool_overrides=json.loads(row.tool_overrides) if row.tool_overrides else None,
    )


def _state_to_config_dict(state: MCPServerState) -> dict[str, Any]:
    """Convert MCPServerState to the old config dict format for compatibility."""
    config: dict[str, Any] = {"type": state.server_type}
    if state.command:
        config["command"] = state.command
    if state.args:
        config["args"] = state.args
    if state.cwd:
        config["cwd"] = state.cwd
    if state.url:
        config["url"] = state.url
    if state.headers:
        config["headers"] = state.headers
    if state.env:
        config["env"] = state.env
    if state.tool_overrides:
        config["toolOverrides"] = state.tool_overrides
    config["requiresConfirmation"] = state.requires_confirmation
    return config


class MCPManager:
    """
    Singleton manager for all MCP server connections.

    Handles:
    - Loading config from SQLite database
    - Connecting to all configured servers on startup
    - Maintaining persistent sessions
    - Creating agno Function wrappers for MCP tools
    - Tool execution via MCP protocol
    - Broadcasting status changes via callbacks
    """

    def __init__(self) -> None:
        self._servers: dict[str, MCPServerState] = {}
        self._initialized = False
        self._lock = asyncio.Lock()
        self._status_callbacks: set[StatusCallback] = set()

    def add_status_callback(self, callback: StatusCallback) -> None:
        """Register a callback for status changes."""
        self._status_callbacks.add(callback)

    def remove_status_callback(self, callback: StatusCallback) -> None:
        """Unregister a status callback."""
        self._status_callbacks.discard(callback)

    def _notify_status_change(
        self, server_id: str, status: ServerStatus, error: str | None, tool_count: int
    ) -> None:
        """Notify all registered callbacks of a status change."""
        for callback in self._status_callbacks:
            try:
                callback(server_id, status, error, tool_count)
            except Exception as e:
                logger.error(f"Status callback error: {e}")

    def _load_servers_from_db(self) -> dict[str, MCPServerState]:
        """Load all enabled MCP servers from database."""
        servers: dict[str, MCPServerState] = {}
        with db_session() as session:
            rows = session.query(McpServer).filter(McpServer.enabled.is_(True)).all()
            for row in rows:
                servers[row.id] = _db_row_to_state(row)
        return servers

    def _save_server_to_db(self, state: MCPServerState) -> None:
        """Save or update a server in the database."""
        with db_session() as session:
            existing = session.query(McpServer).filter(McpServer.id == state.id).first()
            if existing:
                existing.server_type = state.server_type
                existing.enabled = state.enabled
                existing.command = state.command
                existing.args = json.dumps(state.args) if state.args else None
                existing.cwd = state.cwd
                existing.url = state.url
                existing.headers = json.dumps(state.headers) if state.headers else None
                existing.env = json.dumps(state.env) if state.env else None
                existing.requires_confirmation = state.requires_confirmation
                existing.tool_overrides = (
                    json.dumps(state.tool_overrides) if state.tool_overrides else None
                )
            else:
                new_server = McpServer(
                    id=state.id,
                    server_type=state.server_type,
                    enabled=state.enabled,
                    command=state.command,
                    args=json.dumps(state.args) if state.args else None,
                    cwd=state.cwd,
                    url=state.url,
                    headers=json.dumps(state.headers) if state.headers else None,
                    env=json.dumps(state.env) if state.env else None,
                    requires_confirmation=state.requires_confirmation,
                    tool_overrides=(
                        json.dumps(state.tool_overrides) if state.tool_overrides else None
                    ),
                    created_at=datetime.now().isoformat(),
                )
                session.add(new_server)
            session.commit()

    def _delete_server_from_db(self, server_id: str) -> None:
        """Delete a server from the database."""
        with db_session() as session:
            session.query(McpServer).filter(McpServer.id == server_id).delete()
            session.commit()

    async def initialize(self) -> None:
        """
        Load config and connect to all servers.
        Called once on backend startup.
        """
        async with self._lock:
            if self._initialized:
                return

            self._servers = self._load_servers_from_db()
            tasks = []
            for server_id, state in self._servers.items():
                if state.enabled:
                    state.status = "connecting"
                    self._notify_status_change(server_id, "connecting", None, 0)
                    tasks.append(self._connect_server(server_id))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            self._initialized = True
            logger.info(
                f"MCP Manager initialized with {len(self._servers)} server(s)"
            )

    def _set_status(
        self, server_id: str, status: ServerStatus, error: str | None = None
    ) -> None:
        """Set server status and notify callbacks."""
        state = self._servers.get(server_id)
        if state:
            state.status = status
            state.error = error
            self._notify_status_change(
                server_id, status, error, len(state.tools) if status == "connected" else 0
            )

    async def _connect_server(self, server_id: str) -> None:
        """Connect to a single MCP server."""
        state = self._servers.get(server_id)
        if not state:
            return

        self._set_status(server_id, "connecting")

        try:
            if state.command:
                await self._connect_stdio(server_id)
            elif state.url:
                if state.server_type == "sse":
                    await self._connect_sse(server_id)
                else:
                    await self._connect_streamable_http(server_id)
            else:
                raise ValueError("Server must have 'command' or 'url'")

        except Exception as e:
            logger.error(f"Failed to connect to MCP server {server_id}: {e}")
            self._set_status(server_id, "error", _extract_error_message(e))
            state.session = None
            state.tools = []

    async def _connect_stdio(self, server_id: str) -> None:
        """Connect to a stdio-based MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()

        params = StdioServerParameters(
            command=state.command or "",
            args=state.args or [],
            env=state.env,
            cwd=state.cwd,
        )

        async def run_connection():
            try:
                async with stdio_client(params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
                        self._set_status(server_id, "connected")
                        logger.info(
                            f"MCP server {server_id} connected with "
                            f"{len(state.tools)} tool(s)"
                        )
                        state._connection_event.set()

                        while state.status == "connected":
                            await asyncio.sleep(1)

            except asyncio.CancelledError:
                logger.info(f"MCP connection {server_id} cancelled")
                raise
            except Exception as e:
                logger.error(f"MCP connection {server_id} error: {e}")
                self._set_status(server_id, "error", _extract_error_message(e))
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_id} connection timeout")

    async def _connect_sse(self, server_id: str) -> None:
        """Connect to an SSE-based MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()

        async def run_connection():
            try:
                async with sse_client(
                    state.url or "", headers=state.headers
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
                        self._set_status(server_id, "connected")
                        logger.info(
                            f"MCP server {server_id} (SSE) connected with "
                            f"{len(state.tools)} tool(s)"
                        )
                        state._connection_event.set()

                        while state.status == "connected":
                            await asyncio.sleep(1)

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"MCP SSE connection {server_id} error: {e}")
                self._set_status(server_id, "error", _extract_error_message(e))
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_id} connection timeout")

    async def _connect_streamable_http(self, server_id: str) -> None:
        """Connect to a streamable HTTP MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()

        async def run_connection():
            try:
                async with streamable_http_client(state.url or "") as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
                        self._set_status(server_id, "connected")
                        logger.info(
                            f"MCP server {server_id} (HTTP) connected with "
                            f"{len(state.tools)} tool(s)"
                        )
                        state._connection_event.set()

                        while state.status == "connected":
                            await asyncio.sleep(1)

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"MCP HTTP connection {server_id} error: {e}")
                self._set_status(server_id, "error", _extract_error_message(e))
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_id} connection timeout")

    async def reconnect(self, server_id: str) -> None:
        """Reconnect to a failed or disconnected server."""
        state = self._servers.get(server_id)
        if not state:
            raise ValueError(f"Unknown server: {server_id}")

        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except (asyncio.CancelledError, Exception):
                pass

        self._set_status(server_id, "disconnected")
        state.session = None
        state.tools = []

        await self._connect_server(server_id)

    async def disconnect(self, server_id: str) -> None:
        """Disconnect from a server."""
        state = self._servers.get(server_id)
        if not state:
            return

        self._set_status(server_id, "disconnected")

        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except (asyncio.CancelledError, Exception):
                pass

        state.session = None
        state.tools = []

    def get_servers(self) -> list[dict[str, Any]]:
        """
        Return all servers with status for UI.

        Returns list of:
        {
            "id": "github",
            "status": "connected",
            "error": null,
            "toolCount": 5,
            "serverType": "stdio",
            "config": {...}  # without sensitive env vars
        }
        """
        result = []
        for server_id, state in self._servers.items():
            config = _state_to_config_dict(state)
            if "env" in config:
                config["env"] = {k: "***" for k in config["env"].keys()}

            result.append(
                {
                    "id": server_id,
                    "status": state.status,
                    "error": state.error,
                    "toolCount": len(state.tools),
                    "serverType": state.server_type,
                    "config": config,
                }
            )
        return result

    def get_server_config(self, server_id: str, sanitize: bool = True) -> dict[str, Any] | None:
        """
        Get a single server's config, optionally with sanitized env vars.
        
        Args:
            server_id: Server ID to get config for
            sanitize: If True, replace env var values with "***"
        
        Returns:
            Config dict or None if server not found
        """
        state = self._servers.get(server_id)
        if not state:
            return None
        
        config = _state_to_config_dict(state)
        if sanitize and "env" in config:
            config["env"] = {k: "***" for k in config["env"].keys()}
        
        return config

    def get_server_tools(self, server_id: str) -> list[dict[str, Any]]:
        """
        Return tools for a server with UI metadata.

        Applies toolOverrides from config.
        """
        state = self._servers.get(server_id)
        if not state or state.status != "connected":
            return []

        tool_overrides = state.tool_overrides or {}

        result = []
        for tool in state.tools:
            overrides = tool_overrides.get(tool.name, {})

            tool_info = {
                "id": f"mcp:{server_id}:{tool.name}",
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.inputSchema,
                "renderer": overrides.get("renderer"),
                "editable_args": overrides.get("editable_args"),
                "requires_confirmation": overrides.get(
                    "requires_confirmation", state.requires_confirmation
                ),
            }
            result.append(tool_info)

        return result

    def get_all_mcp_tools(self) -> list[dict[str, Any]]:
        """Return all MCP tools across all connected servers."""
        all_tools = []
        for server_id in self._servers:
            all_tools.extend(self.get_server_tools(server_id))
        return all_tools

    def get_mcp_tool(self, server_id: str, tool_name: str) -> MCPTool | None:
        """Get a specific MCP tool definition."""
        state = self._servers.get(server_id)
        if not state:
            return None

        for tool in state.tools:
            if tool.name == tool_name:
                return tool
        return None

    def create_tool_function(self, server_id: str, tool_name: str) -> Function | None:
        """
        Create an agno Function wrapper for an MCP tool.

        The wrapper handles async-to-sync conversion and error handling.
        """
        state = self._servers.get(server_id)
        if not state or state.status != "connected":
            return None

        mcp_tool = self.get_mcp_tool(server_id, tool_name)
        if not mcp_tool:
            return None

        tool_overrides = state.tool_overrides or {}
        overrides = tool_overrides.get(tool_name, {})

        async def mcp_tool_entrypoint(**kwargs: Any) -> str:
            try:
                return await self.call_tool(server_id, tool_name, kwargs)
            except Exception as e:
                logger.error(f"MCP tool {server_id}:{tool_name} error: {e}")
                return f"Error calling tool: {e}"

        mcp_tool_entrypoint.__name__ = f"{server_id}:{tool_name}"
        mcp_tool_entrypoint.__doc__ = mcp_tool.description

        return Function(
            name=f"{server_id}:{tool_name}",
            description=mcp_tool.description,
            parameters=mcp_tool.inputSchema,
            entrypoint=mcp_tool_entrypoint,
            skip_entrypoint_processing=True,
            requires_confirmation=overrides.get(
                "requires_confirmation", state.requires_confirmation
            ),
        )

    async def call_tool(
        self, server_id: str, tool_name: str, args: dict[str, Any]
    ) -> str:
        """Execute an MCP tool and return result as string."""
        state = self._servers.get(server_id)
        if not state:
            raise ValueError(f"Unknown MCP server: {server_id}")

        if state.status != "connected" or not state.session:
            raise RuntimeError(
                f"MCP server {server_id} is not connected "
                f"(status: {state.status})"
            )

        try:
            result = await state.session.call_tool(tool_name, args)

            if hasattr(result, "content") and result.content:
                parts = []
                for block in result.content:
                    if hasattr(block, "text"):
                        parts.append(block.text)
                    elif hasattr(block, "data"):
                        parts.append(f"[Binary data: {len(block.data)} bytes]")
                    else:
                        parts.append(str(block))
                return "\n".join(parts)

            return str(result)

        except Exception as e:
            logger.error(f"MCP tool call failed: {server_id}:{tool_name}: {e}")
            if "connection" in str(e).lower() or "closed" in str(e).lower():
                self._set_status(server_id, "error", _extract_error_message(e))
            raise

    async def add_server(self, server_id: str, config: dict[str, Any]) -> None:
        """Add a new MCP server and connect."""
        if server_id in self._servers:
            raise ValueError(f"Server {server_id} already exists")

        server_type = config.get("type", "stdio")
        if "transport" in config:
            server_type = config["transport"]

        state = MCPServerState(
            id=server_id,
            server_type=server_type,
            enabled=True,
            command=config.get("command"),
            args=config.get("args"),
            cwd=config.get("cwd"),
            url=config.get("url"),
            headers=config.get("headers"),
            env=config.get("env"),
            requires_confirmation=config.get("requiresConfirmation", True),
            tool_overrides=config.get("toolOverrides"),
            status="connecting",
        )

        self._servers[server_id] = state
        self._save_server_to_db(state)
        self._notify_status_change(server_id, "connecting", None, 0)

        await self._connect_server(server_id)

    async def update_server(self, server_id: str, config: dict[str, Any]) -> None:
        """Update MCP server config and reconnect."""
        if server_id not in self._servers:
            raise ValueError(f"Unknown server: {server_id}")

        await self.disconnect(server_id)

        server_type = config.get("type", "stdio")
        if "transport" in config:
            server_type = config["transport"]

        state = self._servers[server_id]
        state.server_type = server_type
        state.command = config.get("command")
        state.args = config.get("args")
        state.cwd = config.get("cwd")
        state.url = config.get("url")
        state.headers = config.get("headers")
        state.env = config.get("env")
        state.requires_confirmation = config.get("requiresConfirmation", True)
        state.tool_overrides = config.get("toolOverrides")

        self._save_server_to_db(state)
        await self._connect_server(server_id)

    async def remove_server(self, server_id: str) -> None:
        """Disconnect and remove an MCP server."""
        if server_id not in self._servers:
            return

        await self.disconnect(server_id)
        del self._servers[server_id]
        self._delete_server_from_db(server_id)

    async def shutdown(self) -> None:
        """Disconnect all servers on shutdown."""
        for server_id in list(self._servers.keys()):
            await self.disconnect(server_id)


_mcp_manager: MCPManager | None = None


def get_mcp_manager() -> MCPManager:
    """Get the global MCP manager instance (singleton)."""
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPManager()
    return _mcp_manager


async def ensure_mcp_initialized() -> MCPManager:
    """Get the MCP manager and ensure it's initialized."""
    mcp = get_mcp_manager()
    if not mcp._initialized:
        await mcp.initialize()
    return mcp
