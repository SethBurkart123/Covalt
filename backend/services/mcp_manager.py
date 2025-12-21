"""
MCP Server Manager - handles connections to MCP servers.

Connects eagerly on startup, maintains persistent sessions,
and provides tools as agno-compatible Function objects.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from agno.tools.function import Function
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Tool as MCPTool

from ..config import get_db_directory

logger = logging.getLogger(__name__)

ServerStatus = Literal["connecting", "connected", "error", "disconnected"]


@dataclass
class MCPServerState:
    """State for a single MCP server connection."""

    id: str
    config: dict[str, Any]
    status: ServerStatus = "disconnected"
    error: str | None = None
    tools: list[MCPTool] = field(default_factory=list)
    session: ClientSession | None = None
    _cleanup_task: asyncio.Task | None = None
    _connection_event: asyncio.Event = field(default_factory=asyncio.Event)


class MCPManager:
    """
    Singleton manager for all MCP server connections.

    Handles:
    - Loading config from db/mcp_servers.json
    - Connecting to all configured servers on startup
    - Maintaining persistent sessions
    - Creating agno Function wrappers for MCP tools
    - Tool execution via MCP protocol
    """

    def __init__(self) -> None:
        self._servers: dict[str, MCPServerState] = {}
        self._config_path = get_db_directory() / "mcp_servers.json"
        self._initialized = False
        self._lock = asyncio.Lock()

    def _load_config(self) -> dict[str, Any]:
        """Load MCP config from file."""
        if not self._config_path.exists():
            return {"mcpServers": {}}

        try:
            with open(self._config_path) as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load MCP config: {e}")
            return {"mcpServers": {}}

    def _save_config(self) -> None:
        """Save MCP config to file."""
        config = {
            "mcpServers": {
                server_id: state.config for server_id, state in self._servers.items()
            }
        }
        try:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._config_path, "w") as f:
                json.dump(config, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save MCP config: {e}")

    async def initialize(self) -> None:
        """
        Load config and connect to all servers.
        Called once on backend startup.
        """
        async with self._lock:
            if self._initialized:
                return

            config = self._load_config()
            servers_config = config.get("mcpServers", {})
            tasks = []
            for server_id, server_config in servers_config.items():
                self._servers[server_id] = MCPServerState(
                    id=server_id,
                    config=server_config,
                    status="connecting",
                )
                tasks.append(self._connect_server(server_id))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            self._initialized = True
            logger.info(
                f"MCP Manager initialized with {len(self._servers)} server(s)"
            )

    async def _connect_server(self, server_id: str) -> None:
        """Connect to a single MCP server."""
        state = self._servers.get(server_id)
        if not state:
            return

        config = state.config
        state.status = "connecting"
        state.error = None

        try:
            if "command" in config:
                await self._connect_stdio(server_id, config)
            elif "url" in config:
                transport = config.get("transport", "streamable-http")
                if transport == "sse":
                    await self._connect_sse(server_id, config)
                else:
                    await self._connect_streamable_http(server_id, config)
            else:
                raise ValueError("Config must have 'command' or 'url'")

        except Exception as e:
            logger.error(f"Failed to connect to MCP server {server_id}: {e}")
            state.status = "error"
            state.error = str(e)
            state.session = None
            state.tools = []

    async def _connect_stdio(self, server_id: str, config: dict) -> None:
        """Connect to a stdio-based MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()

        params = StdioServerParameters(
            command=config["command"],
            args=config.get("args", []),
            env=config.get("env"),
            cwd=config.get("cwd"),
        )

        async def run_connection():
            try:
                async with stdio_client(params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        state.status = "connected"
                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
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
                state.status = "error"
                state.error = str(e)
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_id} connection timeout")

    async def _connect_sse(self, server_id: str, config: dict) -> None:
        """Connect to an SSE-based MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()
        url = config["url"]
        headers = config.get("headers")

        async def run_connection():
            try:
                async with sse_client(url, headers=headers) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        state.status = "connected"

                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
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
                state.status = "error"
                state.error = str(e)
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_id} connection timeout")

    async def _connect_streamable_http(self, server_id: str, config: dict) -> None:
        """Connect to a streamable HTTP MCP server."""
        state = self._servers[server_id]
        state._connection_event.clear()
        url = config["url"]

        async def run_connection():
            try:
                async with streamable_http_client(url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        state.status = "connected"

                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
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
                state.status = "error"
                state.error = str(e)
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

        # Cancel existing connection task
        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except asyncio.CancelledError:
                pass

        state.status = "disconnected"
        state.session = None
        state.tools = []

        await self._connect_server(server_id)

    async def disconnect(self, server_id: str) -> None:
        """Disconnect from a server."""
        state = self._servers.get(server_id)
        if not state:
            return

        state.status = "disconnected"

        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except asyncio.CancelledError:
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
            "config": {...}  # without sensitive env vars
        }
        """
        result = []
        for server_id, state in self._servers.items():
            safe_config = {k: v for k, v in state.config.items() if k != "env"}
            if "env" in state.config:
                safe_config["env"] = {
                    k: "***" for k in state.config["env"].keys()
                }

            result.append(
                {
                    "id": server_id,
                    "status": state.status,
                    "error": state.error,
                    "toolCount": len(state.tools),
                    "config": safe_config,
                }
            )
        return result

    def get_server_tools(self, server_id: str) -> list[dict[str, Any]]:
        """
        Return tools for a server with UI metadata.

        Applies toolOverrides from config.
        """
        state = self._servers.get(server_id)
        if not state or state.status != "connected":
            return []

        tool_overrides = state.config.get("toolOverrides", {})
        server_requires_confirmation = state.config.get("requiresConfirmation", True)

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
                    "requires_confirmation", server_requires_confirmation
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

        tool_overrides = state.config.get("toolOverrides", {})
        overrides = tool_overrides.get(tool_name, {})
        server_requires_confirmation = state.config.get("requiresConfirmation", True)

        manager = self

        async def mcp_tool_entrypoint(**kwargs: Any) -> str:
            try:
                return await manager.call_tool(server_id, tool_name, kwargs)
            except Exception as e:
                logger.error(f"MCP tool {server_id}:{tool_name} error: {e}")
                return f"Error calling tool: {e}"

        # Set function metadata for agno
        mcp_tool_entrypoint.__name__ = f"{server_id}:{tool_name}"
        mcp_tool_entrypoint.__doc__ = mcp_tool.description

        return Function(
            name=f"{server_id}:{tool_name}",
            description=mcp_tool.description,
            parameters=mcp_tool.inputSchema,
            entrypoint=mcp_tool_entrypoint,
            skip_entrypoint_processing=True,
            requires_confirmation=overrides.get(
                "requires_confirmation", server_requires_confirmation
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
                state.status = "error"
                state.error = str(e)
            raise

    async def add_server(self, server_id: str, config: dict[str, Any]) -> None:
        """Add a new MCP server and connect."""
        if server_id in self._servers:
            raise ValueError(f"Server {server_id} already exists")

        self._servers[server_id] = MCPServerState(
            id=server_id,
            config=config,
            status="connecting",
        )

        await self._connect_server(server_id)
        self._save_config()

    async def update_server(
        self, server_id: str, config: dict[str, Any]
    ) -> None:
        """Update MCP server config and reconnect."""
        if server_id not in self._servers:
            raise ValueError(f"Unknown server: {server_id}")

        await self.disconnect(server_id)
        self._servers[server_id].config = config
        await self._connect_server(server_id)
        self._save_config()

    async def remove_server(self, server_id: str) -> None:
        """Disconnect and remove an MCP server."""
        if server_id not in self._servers:
            return

        await self.disconnect(server_id)
        del self._servers[server_id]
        self._save_config()

    async def shutdown(self) -> None:
        """Disconnect all servers on shutdown."""
        for server_id in list(self._servers.keys()):
            await self.disconnect(server_id)


# Singleton instance
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
