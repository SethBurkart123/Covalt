from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import httpx
from agno.tools.function import Function
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Tool as MCPTool

from ..db import db_session
from ..db.models import ToolOverride, Toolset, ToolsetMcpServer
from ..models import format_mcp_tool_id, normalize_renderer_alias
from .oauth_manager import get_oauth_manager

logger = logging.getLogger(__name__)

ServerStatus = Literal[
    "connecting", "connected", "error", "disconnected", "requires_auth"
]
OAuthStatus = Literal["none", "pending", "authenticated", "error"]

SERVER_KEY_DELIMITER = "~"


def build_server_key(toolset_id: str, server_id: str) -> str:
    if SERVER_KEY_DELIMITER in toolset_id:
        raise ValueError(f"Toolset id cannot contain '{SERVER_KEY_DELIMITER}'")
    if SERVER_KEY_DELIMITER in server_id:
        raise ValueError(f"Server id cannot contain '{SERVER_KEY_DELIMITER}'")
    return f"{toolset_id}{SERVER_KEY_DELIMITER}{server_id}"


def split_server_key(server_key: str) -> tuple[str, str]:
    if SERVER_KEY_DELIMITER not in server_key:
        raise ValueError("Invalid server key format")
    toolset_id, server_id = server_key.split(SERVER_KEY_DELIMITER, 1)
    return toolset_id, server_id


def _resolve_env_vars(env: dict[str, str] | None, server_label: str) -> dict[str, str] | None:
    if not env:
        return env
    resolved: dict[str, str] = {}
    for key, value in env.items():
        if not isinstance(value, str):
            resolved[key] = value  # type: ignore[assignment]
            continue
        matches = re.findall(r"\$\{([A-Z0-9_]+)\}", value)
        if not matches:
            resolved[key] = value
            continue
        resolved_value = value
        for var_name in matches:
            env_value = os.environ.get(var_name)
            if env_value is None:
                logger.warning(
                    f"MCP server {server_label} env var '{var_name}' not set; "
                    "leaving placeholder as-is"
                )
                continue
            resolved_value = resolved_value.replace(f"${{{var_name}}}", env_value)
        resolved[key] = resolved_value
    return resolved

def _extract_error_message(e: BaseException) -> str:
    if isinstance(e, BaseExceptionGroup):
        return "; ".join(_extract_error_message(exc) for exc in e.exceptions)
    return str(e)


StatusCallback = Callable[[str, ServerStatus, str | None, int], None]

AUTO_RECONNECT_DELAYS = [1, 3, 10, 15, 60]


@dataclass
class MCPServerState:
    id: str
    server_id: str
    server_type: str
    toolset_id: str
    toolset_name: str | None = None
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
    _retry_count: int = 0
    _retry_task: asyncio.Task | None = None
    oauth_status: OAuthStatus = "none"
    oauth_provider_name: str | None = None
    auth_hint: str | None = None


def _db_row_to_state(row: ToolsetMcpServer) -> MCPServerState:
    server_key = build_server_key(row.toolset_id, row.id)
    return MCPServerState(
        id=server_key,
        server_id=row.id,
        server_type=row.server_type,
        toolset_id=row.toolset_id,
        toolset_name=row.toolset.name if getattr(row, "toolset", None) else None,
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
                state = _db_row_to_state(row)
                servers[state.id] = state
        return servers

    def _save_server_to_db(self, state: MCPServerState) -> None:
        with db_session() as sess:
            existing = (
                sess.query(ToolsetMcpServer)
                .filter(ToolsetMcpServer.id == state.server_id)
                .filter(ToolsetMcpServer.toolset_id == state.toolset_id)
                .first()
            )
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
            else:
                new_server = ToolsetMcpServer(
                    id=state.server_id,
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

    def _delete_server_from_db(self, server_key: str) -> None:
        toolset_id, server_id = split_server_key(server_key)
        with db_session() as sess:
            sess.query(ToolsetMcpServer).filter(
                ToolsetMcpServer.id == server_id,
                ToolsetMcpServer.toolset_id == toolset_id,
            ).delete()
            sess.commit()

    def _get_tool_overrides(self, toolset_id: str) -> dict[str, dict[str, Any]]:
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

    def _get_toolset_name(self, toolset_id: str) -> str | None:
        with db_session() as sess:
            toolset = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            return toolset.name if toolset else None

    def resolve_server_key(self, server_id_or_key: str) -> str | None:
        if server_id_or_key in self._servers:
            return server_id_or_key

        matches = [
            key
            for key, state in self._servers.items()
            if state.server_id == server_id_or_key
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(
                f"Ambiguous MCP server id '{server_id_or_key}'. "
                "Use the toolset-qualified server key."
            )
        return None

    def get_server_state(self, server_key: str) -> MCPServerState | None:
        return self._servers.get(server_key)

    def _format_server_label(self, state: MCPServerState) -> str:
        return f"{state.toolset_id}/{state.server_id}"

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
        if not state:
            return

        prev_status = state.status
        state.status = status
        state.error = error
        self._notify_status_change(
            server_id,
            status,
            error,
            len(state.tools) if status == "connected" else 0,
        )

        if status == "connected":
            state._retry_count = 0
            self._cancel_retry(state)
        elif status == "disconnected":
            state._retry_count = 0
            self._cancel_retry(state)
        elif status == "error" and prev_status == "connected":
            self._schedule_auto_reconnect(server_id, state)

    def _cancel_retry(self, state: MCPServerState) -> None:
        if state._retry_task and not state._retry_task.done():
            state._retry_task.cancel()
        state._retry_task = None

    def _schedule_auto_reconnect(self, server_id: str, state: MCPServerState) -> None:
        if state._retry_count >= len(AUTO_RECONNECT_DELAYS):
            return
        self._cancel_retry(state)
        state._retry_task = asyncio.create_task(self._auto_reconnect(server_id))

    async def _auto_reconnect(self, server_id: str) -> None:
        state = self._servers.get(server_id)
        if not state:
            return

        while state._retry_count < len(AUTO_RECONNECT_DELAYS):
            delay = AUTO_RECONNECT_DELAYS[state._retry_count]
            state._retry_count += 1
            attempt = state._retry_count

            logger.info(
                f"MCP server {server_id}: auto-reconnect attempt {attempt}/"
                f"{len(AUTO_RECONNECT_DELAYS)} in {delay}s"
            )

            await asyncio.sleep(delay)

            if server_id not in self._servers:
                return
            if state.status == "connected":
                return
            if state.status == "disconnected":
                return

            try:
                await self._do_reconnect(server_id)
            except Exception as e:
                logger.warning(
                    f"MCP server {server_id}: auto-reconnect attempt "
                    f"{attempt} failed: {e}"
                )

            if state.status == "connected":
                logger.info(
                    f"MCP server {server_id}: auto-reconnect succeeded "
                    f"on attempt {attempt}"
                )
                return

        logger.warning(
            f"MCP server {server_id}: all {len(AUTO_RECONNECT_DELAYS)} "
            f"auto-reconnect attempts exhausted"
        )

    async def _do_reconnect(self, server_id: str) -> None:
        """Reconnect without cancelling the retry task (internal use)."""
        state = self._servers.get(server_id)
        if not state:
            return

        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except (asyncio.CancelledError, Exception):
                pass

        state.session = None
        state.tools = []
        await self._connect_server(server_id)

    async def _connect_server(self, server_key: str) -> None:
        state = self._servers.get(server_key)
        if not state:
            return

        self._set_status(server_key, "connecting")
        server_label = self._format_server_label(state)

        try:
            if state.command:
                await self._connect_stdio(server_key)
            elif state.url:
                if state.server_type == "sse":
                    await self._connect_sse(server_key)
                else:
                    await self._connect_streamable_http(server_key)
            else:
                raise ValueError("Server must have 'command' or 'url'")

        except Exception as e:
            logger.error(f"Failed to connect to MCP server {server_label}: {e}")
            self._set_status(server_key, "error", _extract_error_message(e))
            state.session = None
            state.tools = []

    async def _connect_stdio(self, server_key: str) -> None:
        state = self._servers[server_key]
        state._connection_event.clear()
        server_label = self._format_server_label(state)

        params = StdioServerParameters(
            command=state.command or "",
            args=state.args or [],
            env=_resolve_env_vars(state.env, server_label),
            cwd=state.cwd,
        )

        async def run_connection():
            read_fd, write_fd = os.pipe()
            stderr_file = os.fdopen(write_fd, "w")
            captured_stderr: list[str] = []

            async def read_stderr():
                loop = asyncio.get_event_loop()
                reader = asyncio.StreamReader()
                read_pipe = os.fdopen(read_fd, "rb")
                transport, _ = await loop.connect_read_pipe(
                    lambda: asyncio.StreamReaderProtocol(reader),
                    read_pipe,
                )
                try:
                    while True:
                        line = await reader.readline()
                        if not line:
                            break
                        text = line.decode(errors="replace").rstrip("\n")
                        if text:
                            captured_stderr.append(text)
                            logger.debug(f"MCP {server_label} stderr: {text}")
                except Exception:
                    pass
                finally:
                    transport.close()

            stderr_task = asyncio.create_task(read_stderr())

            try:
                async with stdio_client(params, errlog=stderr_file) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        state.session = session
                        tools_result = await session.list_tools()
                        state.tools = tools_result.tools
                        self._set_status(server_key, "connected")
                        logger.info(
                            f"MCP server {server_label} connected with "
                            f"{len(state.tools)} tool(s)"
                        )
                        state._connection_event.set()

                        while state.status == "connected":
                            await asyncio.sleep(10)
                            try:
                                await asyncio.wait_for(session.send_ping(), timeout=5.0)
                            except Exception:
                                error_msg = (
                                    "\n".join(captured_stderr[-20:])
                                    if captured_stderr
                                    else "Connection lost"
                                )
                                self._set_status(server_key, "error", error_msg)
                                break

            except asyncio.CancelledError:
                raise
            except Exception as e:
                error_msg = (
                    "\n".join(captured_stderr[-20:])
                    if captured_stderr
                    else _extract_error_message(e)
                )
                logger.error(f"MCP connection {server_label} error: {error_msg}")
                self._set_status(server_key, "error", error_msg)
                state.session = None
                state._connection_event.set()
            finally:
                try:
                    stderr_file.close()
                except Exception:
                    pass
                stderr_task.cancel()
                try:
                    await stderr_task
                except (asyncio.CancelledError, Exception):
                    pass

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_label} connection timeout")

    async def _connect_sse(self, server_key: str) -> None:
        state = self._servers[server_key]
        state._connection_event.clear()
        server_label = self._format_server_label(state)

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
                        self._set_status(server_key, "connected")
                        logger.info(
                            f"MCP server {server_label} (SSE) connected with "
                            f"{len(state.tools)} tool(s)"
                        )
                        state._connection_event.set()

                        while state.status == "connected":
                            await asyncio.sleep(10)
                            try:
                                await asyncio.wait_for(session.send_ping(), timeout=5.0)
                            except Exception as e:
                                self._set_status(
                                    server_key,
                                    "error",
                                    _extract_error_message(e),
                                )
                                break

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"MCP SSE connection {server_label} error: {e}")
                self._set_status(server_key, "error", _extract_error_message(e))
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_label} connection timeout")

    async def _connect_streamable_http(self, server_key: str) -> None:
        state = self._servers[server_key]
        state._connection_event.clear()
        server_label = self._format_server_label(state)

        oauth = get_oauth_manager()
        has_oauth_tokens = oauth.has_valid_tokens(state.server_id, state.toolset_id)

        async def require_auth() -> bool:
            if not state.url:
                return False
            probe = await oauth.probe_oauth_requirement(state.url)
            if not probe.get("requiresOAuth"):
                return False
            state.oauth_status = "none"
            state.oauth_provider_name = probe.get("providerName")
            state.auth_hint = probe.get("authHint")
            self._set_status(server_key, "requires_auth")
            state._connection_event.set()
            return True

        async def run_connection():
            try:
                if not has_oauth_tokens and await require_auth():
                    return

                if has_oauth_tokens:
                    oauth_provider = oauth.create_oauth_provider(
                        state.server_id, state.toolset_id, state.url or ""
                    )
                    state.oauth_status = "authenticated"
                    async with httpx.AsyncClient(
                        auth=oauth_provider, timeout=30.0
                    ) as http_client:
                        async with streamable_http_client(
                            state.url or "", http_client=http_client
                        ) as (read, write, _):
                            await self._run_mcp_session(server_key, state, read, write)
                else:
                    async with streamable_http_client(state.url or "") as (
                        read,
                        write,
                        _,
                    ):
                        await self._run_mcp_session(server_key, state, read, write)

            except asyncio.CancelledError:
                raise
            except Exception as e:
                error_str = str(e).lower()
                if (
                    not has_oauth_tokens
                    and ("401" in error_str or "unauthorized" in error_str)
                    and await require_auth()
                ):
                    return

                logger.error(f"MCP HTTP connection {server_label} error: {e}")
                self._set_status(server_key, "error", _extract_error_message(e))
                state.session = None
                state._connection_event.set()

        state._cleanup_task = asyncio.create_task(run_connection())

        try:
            await asyncio.wait_for(state._connection_event.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.warning(f"MCP server {server_label} connection timeout")

    async def _run_mcp_session(
        self, server_key: str, state: MCPServerState, read: Any, write: Any
    ) -> None:
        async with ClientSession(read, write) as session:
            await session.initialize()
            state.session = session
            tools_result = await session.list_tools()
            state.tools = tools_result.tools
            self._set_status(server_key, "connected")
            logger.info(
                f"MCP server {self._format_server_label(state)} (HTTP) connected with "
                f"{len(state.tools)} tool(s)"
            )
            state._connection_event.set()

            while state.status == "connected":
                await asyncio.sleep(10)
                try:
                    await asyncio.wait_for(session.send_ping(), timeout=5.0)
                except Exception as e:
                    self._set_status(server_key, "error", _extract_error_message(e))
                    break

    async def reconnect(self, server_id: str) -> None:
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state:
            raise ValueError(f"Unknown server: {server_id}")

        self._cancel_retry(state)
        state._retry_count = 0

        if state._cleanup_task and not state._cleanup_task.done():
            state._cleanup_task.cancel()
            try:
                await state._cleanup_task
            except (asyncio.CancelledError, Exception):
                pass

        self._set_status(server_key, "disconnected")
        state.session = None
        state.tools = []

        await self._connect_server(server_key)

    async def disconnect(self, server_id: str) -> None:
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state:
            return

        self._set_status(server_key, "disconnected")

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
                    "serverId": state.server_id,
                    "toolsetId": state.toolset_id,
                    "toolsetName": state.toolset_name or state.toolset_id,
                    "status": state.status,
                    "error": state.error,
                    "toolCount": len(state.tools),
                    "serverType": state.server_type,
                    "config": config,
                    "oauthStatus": state.oauth_status,
                    "oauthProviderName": state.oauth_provider_name,
                    "authHint": state.auth_hint,
                }
            )
        return result

    def get_server_config(
        self, server_id: str, sanitize: bool = True
    ) -> dict[str, Any] | None:
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state:
            return None

        config = _state_to_config_dict(state)
        if sanitize and "env" in config:
            config["env"] = {k: "***" for k in config["env"].keys()}

        return config

    def get_server_tools(self, server_id: str) -> list[dict[str, Any]]:
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state or state.status != "connected":
            return []

        tool_overrides = self._get_tool_overrides(state.toolset_id)

        result = []
        for tool in state.tools:
            override_id = f"{state.server_id}:{tool.name}"
            overrides = tool_overrides.get(override_id, {})

            if not overrides.get("enabled", True):
                continue

            tool_info = {
                "id": format_mcp_tool_id(server_key, tool.name),
                "name": overrides.get("name_override") or tool.name,
                "description": overrides.get("description_override")
                or tool.description,
                "inputSchema": tool.inputSchema,
                "renderer": normalize_renderer_alias(overrides.get("renderer")),
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
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state:
            return None

        for tool in state.tools:
            if tool.name == tool_name:
                return tool
        return None

    def create_tool_function(self, server_id: str, tool_name: str) -> Function | None:
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state or state.status != "connected":
            return None

        mcp_tool = self.get_mcp_tool(server_key, tool_name)
        if not mcp_tool:
            return None

        tool_overrides = self._get_tool_overrides(state.toolset_id)
        override_id = f"{state.server_id}:{tool_name}"
        overrides = tool_overrides.get(override_id, {})

        if not overrides.get("enabled", True):
            return None

        async def mcp_tool_entrypoint(**kwargs: Any) -> str:
            try:
                return await self.call_tool(server_key, tool_name, kwargs)
            except Exception as e:
                logger.error(f"MCP tool {server_key}:{tool_name} error: {e}")
                return f"Error calling tool: {e}"

        mcp_tool_entrypoint.__name__ = f"{server_key}:{tool_name}"
        mcp_tool_entrypoint.__doc__ = (
            overrides.get("description_override") or mcp_tool.description
        )

        return Function(
            name=f"{server_key}:{tool_name}",
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
        server_key = self.resolve_server_key(server_id) or server_id
        state = self._servers.get(server_key)
        if not state:
            raise ValueError(f"Unknown MCP server: {server_id}")

        if state.status != "connected" or not state.session:
            raise RuntimeError(
                f"MCP server {server_key} is not connected (status: {state.status})"
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
            logger.error(f"MCP tool call failed: {server_key}:{tool_name}: {e}")
            if "connection" in str(e).lower() or "closed" in str(e).lower():
                self._set_status(server_key, "error", _extract_error_message(e))
            raise

    async def add_server(
        self, server_id: str, config: dict[str, Any], toolset_id: str
    ) -> None:
        server_key = build_server_key(toolset_id, server_id)
        if server_key in self._servers:
            raise ValueError(f"Server {server_id} already exists in toolset {toolset_id}")

        server_type = config.get("type", "stdio")
        if "transport" in config:
            server_type = config["transport"]

        state = MCPServerState(
            id=server_key,
            server_id=server_id,
            server_type=server_type,
            toolset_id=toolset_id,
            toolset_name=self._get_toolset_name(toolset_id),
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

        self._servers[server_key] = state
        self._save_server_to_db(state)
        self._notify_status_change(server_key, "connecting", None, 0)

        await self._connect_server(server_key)

    async def update_server(self, server_id: str, config: dict[str, Any]) -> None:
        server_key = self.resolve_server_key(server_id) or server_id
        if server_key not in self._servers:
            raise ValueError(f"Unknown server: {server_id}")

        await self.disconnect(server_key)

        server_type = config.get("type", "stdio")
        if "transport" in config:
            server_type = config["transport"]

        state = self._servers[server_key]
        state.server_type = server_type
        state.command = config.get("command")
        state.args = config.get("args")
        state.cwd = config.get("cwd")
        state.url = config.get("url")
        state.headers = config.get("headers")
        state.env = config.get("env")
        state.requires_confirmation = config.get("requiresConfirmation", True)

        self._save_server_to_db(state)
        await self._connect_server(server_key)

    async def remove_server(self, server_id: str) -> None:
        server_key = self.resolve_server_key(server_id) or server_id
        if server_key not in self._servers:
            return

        await self.disconnect(server_key)
        del self._servers[server_key]
        self._delete_server_from_db(server_key)

    async def rename_server(
        self,
        old_server_key: str,
        new_toolset_id: str,
        new_server_id: str,
        new_toolset_name: str | None = None,
    ) -> str:
        if old_server_key not in self._servers:
            raise ValueError(f"Unknown server: {old_server_key}")

        await self.disconnect(old_server_key)

        state = self._servers.pop(old_server_key)
        new_server_key = build_server_key(new_toolset_id, new_server_id)
        state.id = new_server_key
        state.server_id = new_server_id
        state.toolset_id = new_toolset_id
        if new_toolset_name is not None:
            state.toolset_name = new_toolset_name
        state.status = "disconnected"
        state.error = None

        self._servers[new_server_key] = state
        self._save_server_to_db(state)
        self._notify_status_change(new_server_key, "disconnected", None, 0)
        return new_server_key

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


async def shutdown_mcp() -> None:
    """Shut down the MCP manager if it was initialized."""
    if _mcp_manager is not None:
        await _mcp_manager.shutdown()
