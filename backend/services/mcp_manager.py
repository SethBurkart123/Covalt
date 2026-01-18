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
from ..db.models import ToolOverride, Toolset, ToolsetMcpServer

logger = logging.getLogger(__name__)

ServerStatus = Literal["connecting", "connected", "error", "disconnected"]


def _extract_error_message(e: BaseException) -> str:
    if isinstance(e, BaseExceptionGroup):
        return "; ".join(_extract_error_message(exc) for exc in e.exceptions)
    return str(e)


StatusCallback = Callable[[str, ServerStatus, str | None, int], None]


@dataclass
class MCPServerState:
    id: str
    server_type: str
    toolset_id: str
    enabled: bool = True
    command: str | None = None
    args: list[str] | None = None
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    env: dict[str, str] | None = None
    requires_confirmation: bool = True
    status: ServerStatus = "disconnected"
    error: str | None = None
    tools: list[MCPTool] = field(default_factory=list)
    session: ClientSession | None = None
    _cleanup_task: asyncio.Task | None = None
    _connection_event: asyncio.Event = field(default_factory=asyncio.Event)


def _db_row_to_state(row: ToolsetMcpServer) -> MCPServerState:
    return MCPServerState(
        id=row.id,
        server_type=row.server_type,
        toolset_id=row.toolset_id,
        enabled=row.enabled,
        command=row.command,
        args=json.loads(row.args) if row.args else None,
        cwd=row.cwd,
        url=row.url,
        headers=json.loads(row.headers) if row.headers else None,
        env=json.loads(row.env) if row.env else None,
        requires_confirmation=row.requires_confirmation,
    )


def _state_to_config_dict(state: MCPServerState) -> dict[str, Any]:
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
    config["requiresConfirmation"] = state.requires_confirmation
    return config


class MCPManager:
    def __init__(self) -> None:
        self._servers: dict[str, MCPServerState] = {}
        self._initialized = False
        self._lock = asyncio.Lock()
        self._status_callbacks: set[StatusCallback] = set()

    def add_status_callback(self, callback: StatusCallback) -> None:
        self._status_callbacks.add(callback)

    def remove_status_callback(self, callback: StatusCallback) -> None:
        self._status_callbacks.discard(callback)

    def _notify_status_change(
        self, server_id: str, status: ServerStatus, error: str | None, tool_count: int
    ) -> None:
        for callback in self._status_callbacks:
            try:
                callback(server_id, status, error, tool_count)
            except Exception as e:
                logger.error(f"Status callback error: {e}")

    def _load_servers_from_db(self) -> dict[str, MCPServerState]:
        servers: dict[str, MCPServerState] = {}
        with db_session() as sess:
            rows = (
                sess.query(ToolsetMcpServer)
                .join(Toolset, ToolsetMcpServer.toolset_id == Toolset.id)
                .filter(ToolsetMcpServer.enabled.is_(True))
                .filter(Toolset.enabled.is_(True))
                .all()
            )
            for row in rows:
                servers[row.id] = _db_row_to_state(row)
        return servers

    def _save_server_to_db(self, state: MCPServerState) -> None:
        with db_session() as sess:
            existing = (
                sess.query(ToolsetMcpServer)
                .filter(ToolsetMcpServer.id == state.id)
                .first()
            )
            if existing:
                existing.server_type = state.server_type
                existing.toolset_id = state.toolset_id
                existing.enabled = state.enabled
                existing.command = state.command
                existing.args = json.dumps(state.args) if state.args else None
                existing.cwd = state.cwd
                existing.url = state.url
                existing.headers = json.dumps(state.headers) if state.headers else None
                existing.env = json.dumps(state.env) if state.env else None
                existing.requires_confirmation = state.requires_confirmation
            else:
                new_server = ToolsetMcpServer(
                    id=state.id,
                    toolset_id=state.toolset_id,
                    server_type=state.server_type,
                    enabled=state.enabled,
                    command=state.command,
                    args=json.dumps(state.args) if state.args else None,
                    cwd=state.cwd,
                    url=state.url,
                    headers=json.dumps(state.headers) if state.headers else None,
                    env=json.dumps(state.env) if state.env else None,
                    requires_confirmation=state.requires_confirmation,
                    created_at=datetime.now().isoformat(),
                )
                sess.add(new_server)
            sess.commit()

    def _delete_server_from_db(self, server_id: str) -> None:
        with db_session() as sess:
            sess.query(ToolsetMcpServer).filter(
                ToolsetMcpServer.id == server_id
            ).delete()
            sess.commit()

    def _get_tool_overrides(self, toolset_id: str) -> dict[str, dict[str, Any]]:
        """Get tool overrides for a toolset from the database."""
        overrides: dict[str, dict[str, Any]] = {}
        with db_session() as sess:
            rows = (
                sess.query(ToolOverride)
                .filter(ToolOverride.toolset_id == toolset_id)
                .all()
            )
            for row in rows:
                overrides[row.tool_id] = {
                    "renderer": row.renderer,
                    "renderer_config": json.loads(row.renderer_config)
                    if row.renderer_config
                    else None,
                    "name_override": row.name_override,
                    "description_override": row.description_override,
                    "requires_confirmation": row.requires_confirmation,
                    "enabled": row.enabled,
                }
        return overrides

    async def initialize(self) -> None:
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
            logger.info(f"MCP Manager initialized with {len(self._servers)} server(s)")

    async def reload_from_db(self) -> list[str]:
        async with self._lock:
            db_servers = self._load_servers_from_db()
            new_server_ids: list[str] = []

            for server_id, state in db_servers.items():
                if server_id not in self._servers:
                    self._servers[server_id] = state
                    new_server_ids.append(server_id)

            tasks = []
            for server_id in new_server_ids:
                state = self._servers[server_id]
                if state.enabled:
                    state.status = "connecting"
                    self._notify_status_change(server_id, "connecting", None, 0)
                    tasks.append(self._connect_server(server_id))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            if new_server_ids:
                logger.info(f"Loaded {len(new_server_ids)} new MCP server(s) from DB")

            return new_server_ids

    def _set_status(
        self, server_id: str, status: ServerStatus, error: str | None = None
    ) -> None:
        state = self._servers.get(server_id)
        if state:
            state.status = status
            state.error = error
            self._notify_status_change(
                server_id,
                status,
                error,
                len(state.tools) if status == "connected" else 0,
            )

    async def _connect_server(self, server_id: str) -> None:
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
                            await asyncio.sleep(10)
                            try:
                                await asyncio.wait_for(session.send_ping(), timeout=5.0)
                            except Exception:
                                self._set_status(
                                    server_id,
                                    "error",
                                    "Connection lost",
                                )
                                break

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
        state = self._servers[server_id]
        state._connection_event.clear()

        async def run_connection():
            try:
                async with sse_client(state.url or "", headers=state.headers) as (
                    read,
                    write,
                ):
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
                            await asyncio.sleep(10)
                            try:
                                await asyncio.wait_for(session.send_ping(), timeout=5.0)
                            except Exception:
                                self._set_status(
                                    server_id,
                                    "error",
                                    "Connection lost",
                                )
                                break

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
                            await asyncio.sleep(10)
                            try:
                                await asyncio.wait_for(session.send_ping(), timeout=5.0)
                            except Exception:
                                self._set_status(
                                    server_id,
                                    "error",
                                    "Connection lost",
                                )
                                break

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

    async def disconnect_toolset_servers(self, toolset_id: str) -> list[str]:
        disconnected: list[str] = []

        for server_id, state in list(self._servers.items()):
            if state.toolset_id == toolset_id:
                await self.disconnect(server_id)
                disconnected.append(server_id)

        if disconnected:
            logger.info(
                f"Disconnected {len(disconnected)} MCP server(s) "
                f"from toolset '{toolset_id}'"
            )

        return disconnected

    def get_servers(self) -> list[dict[str, Any]]:
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

    def get_server_config(
        self, server_id: str, sanitize: bool = True
    ) -> dict[str, Any] | None:
        state = self._servers.get(server_id)
        if not state:
            return None

        config = _state_to_config_dict(state)
        if sanitize and "env" in config:
            config["env"] = {k: "***" for k in config["env"].keys()}

        return config

    def get_server_tools(self, server_id: str) -> list[dict[str, Any]]:
        state = self._servers.get(server_id)
        if not state or state.status != "connected":
            return []

        tool_overrides = self._get_tool_overrides(state.toolset_id)

        result = []
        for tool in state.tools:
            tool_id = f"{server_id}:{tool.name}"
            overrides = tool_overrides.get(tool_id, {})

            if not overrides.get("enabled", True):
                continue

            tool_info = {
                "id": f"mcp:{tool_id}",
                "name": overrides.get("name_override") or tool.name,
                "description": overrides.get("description_override")
                or tool.description,
                "inputSchema": tool.inputSchema,
                "renderer": overrides.get("renderer"),
                "renderer_config": overrides.get("renderer_config"),
                "requires_confirmation": overrides.get("requires_confirmation")
                if overrides.get("requires_confirmation") is not None
                else state.requires_confirmation,
            }
            result.append(tool_info)

        return result

    def get_all_mcp_tools(self) -> list[dict[str, Any]]:
        all_tools = []
        for server_id in self._servers:
            all_tools.extend(self.get_server_tools(server_id))
        return all_tools

    def get_mcp_tool(self, server_id: str, tool_name: str) -> MCPTool | None:
        state = self._servers.get(server_id)
        if not state:
            return None

        for tool in state.tools:
            if tool.name == tool_name:
                return tool
        return None

    def create_tool_function(self, server_id: str, tool_name: str) -> Function | None:
        state = self._servers.get(server_id)
        if not state or state.status != "connected":
            return None

        mcp_tool = self.get_mcp_tool(server_id, tool_name)
        if not mcp_tool:
            return None

        tool_overrides = self._get_tool_overrides(state.toolset_id)
        tool_id = f"{server_id}:{tool_name}"
        overrides = tool_overrides.get(tool_id, {})

        if not overrides.get("enabled", True):
            return None

        async def mcp_tool_entrypoint(**kwargs: Any) -> str:
            try:
                return await self.call_tool(server_id, tool_name, kwargs)
            except Exception as e:
                logger.error(f"MCP tool {server_id}:{tool_name} error: {e}")
                return f"Error calling tool: {e}"

        mcp_tool_entrypoint.__name__ = tool_id
        mcp_tool_entrypoint.__doc__ = (
            overrides.get("description_override") or mcp_tool.description
        )

        return Function(
            name=tool_id,
            description=overrides.get("description_override") or mcp_tool.description,
            parameters=mcp_tool.inputSchema,
            entrypoint=mcp_tool_entrypoint,
            skip_entrypoint_processing=True,
            requires_confirmation=overrides.get("requires_confirmation")
            if overrides.get("requires_confirmation") is not None
            else state.requires_confirmation,
        )

    async def call_tool(
        self, server_id: str, tool_name: str, args: dict[str, Any]
    ) -> str:
        state = self._servers.get(server_id)
        if not state:
            raise ValueError(f"Unknown MCP server: {server_id}")

        if state.status != "connected" or not state.session:
            raise RuntimeError(
                f"MCP server {server_id} is not connected (status: {state.status})"
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

    async def add_server(
        self, server_id: str, config: dict[str, Any], toolset_id: str
    ) -> None:
        if server_id in self._servers:
            raise ValueError(f"Server {server_id} already exists")

        server_type = config.get("type", "stdio")
        if "transport" in config:
            server_type = config["transport"]

        state = MCPServerState(
            id=server_id,
            server_type=server_type,
            toolset_id=toolset_id,
            enabled=True,
            command=config.get("command"),
            args=config.get("args"),
            cwd=config.get("cwd"),
            url=config.get("url"),
            headers=config.get("headers"),
            env=config.get("env"),
            requires_confirmation=config.get("requiresConfirmation", True),
            status="connecting",
        )

        self._servers[server_id] = state
        self._save_server_to_db(state)
        self._notify_status_change(server_id, "connecting", None, 0)

        await self._connect_server(server_id)

    async def update_server(self, server_id: str, config: dict[str, Any]) -> None:
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

        self._save_server_to_db(state)
        await self._connect_server(server_id)

    async def remove_server(self, server_id: str) -> None:
        if server_id not in self._servers:
            return

        await self.disconnect(server_id)
        del self._servers[server_id]
        self._delete_server_from_db(server_id)

    async def shutdown(self) -> None:
        for server_id in list(self._servers.keys()):
            await self.disconnect(server_id)


_mcp_manager: MCPManager | None = None


def get_mcp_manager() -> MCPManager:
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPManager()
    return _mcp_manager


async def ensure_mcp_initialized() -> MCPManager:
    mcp = get_mcp_manager()
    if not mcp._initialized:
        await mcp.initialize()
    return mcp
