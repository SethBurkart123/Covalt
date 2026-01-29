from __future__ import annotations

import asyncio
import logging
from typing import Any

from pydantic import BaseModel
from zynk import WebSocket, message

from ..services.mcp_manager import get_mcp_manager, ServerStatus

logger = logging.getLogger(__name__)

_connected_clients: set["EventsWebSocket"] = set()
_clients_lock = asyncio.Lock()


class McpServerStatus(BaseModel):
    id: str
    status: str
    error: str | None = None
    tool_count: int = 0
    oauth_status: str | None = None
    oauth_provider_name: str | None = None
    auth_hint: str | None = None
    config: dict[str, Any] | None = None


class McpServersSnapshot(BaseModel):
    servers: list[McpServerStatus]


class WorkspaceFilesChanged(BaseModel):
    chat_id: str
    changed_paths: list[str]
    deleted_paths: list[str]


class Ping(BaseModel):
    pass


class ServerEvents:
    mcp_status: McpServerStatus
    mcp_servers: McpServersSnapshot
    workspace_files_changed: WorkspaceFilesChanged


class ClientEvents:
    ping: Ping


EventsWebSocket = WebSocket[ServerEvents, ClientEvents]


def _mcp_status_callback(
    server_id: str, status: ServerStatus, error: str | None, tool_count: int
) -> None:
    loop = asyncio.get_event_loop()
    if loop.is_running():
        asyncio.create_task(_broadcast_mcp_status(server_id, status, error, tool_count))


async def _broadcast_mcp_status(
    server_id: str, status: ServerStatus, error: str | None, tool_count: int
) -> None:
    mcp = get_mcp_manager()
    server_data = next((s for s in mcp.get_servers() if s["id"] == server_id), None)

    status_update = McpServerStatus(
        id=server_id,
        status=status,
        error=error,
        tool_count=tool_count,
        oauth_status=server_data.get("oauthStatus") if server_data else None,
        oauth_provider_name=server_data.get("oauthProviderName")
        if server_data
        else None,
        auth_hint=server_data.get("authHint") if server_data else None,
        config=server_data.get("config") if server_data else None,
    )

    async with _clients_lock:
        disconnected = []
        for client in _connected_clients:
            try:
                if client.is_connected:
                    await client.send("mcp_status", status_update)
            except Exception as e:
                logger.debug(f"Failed to send to client: {e}")
                disconnected.append(client)

        for client in disconnected:
            _connected_clients.discard(client)


async def broadcast_workspace_files_changed(
    chat_id: str,
    changed_paths: list[str],
    deleted_paths: list[str],
) -> None:
    event = WorkspaceFilesChanged(
        chat_id=chat_id,
        changed_paths=changed_paths,
        deleted_paths=deleted_paths,
    )

    async with _clients_lock:
        disconnected = []
        for client in _connected_clients:
            try:
                if client.is_connected:
                    await client.send("workspace_files_changed", event)
            except Exception as e:
                logger.debug(f"Failed to send workspace change to client: {e}")
                disconnected.append(client)

        for client in disconnected:
            _connected_clients.discard(client)


def _get_mcp_servers_snapshot() -> McpServersSnapshot:
    mcp = get_mcp_manager()
    servers = mcp.get_servers()

    return McpServersSnapshot(
        servers=[
            McpServerStatus(
                id=s["id"],
                status=s["status"],
                error=s.get("error"),
                tool_count=s.get("toolCount", 0),
                oauth_status=s.get("oauthStatus"),
                oauth_provider_name=s.get("oauthProviderName"),
                auth_hint=s.get("authHint"),
                config=s.get("config"),
            )
            for s in servers
        ]
    )


def _register_mcp_callback() -> None:
    mcp = get_mcp_manager()
    mcp.add_status_callback(_mcp_status_callback)


@message
async def events(ws: EventsWebSocket) -> None:
    _register_mcp_callback()

    async with _clients_lock:
        _connected_clients.add(ws)

    logger.debug("Events WebSocket client connected")

    try:
        snapshot = _get_mcp_servers_snapshot()
        await ws.send("mcp_servers", snapshot)

        @ws.on("ping")
        async def on_ping(data: Ping) -> None:
            pass

        await ws.listen()

    finally:
        async with _clients_lock:
            _connected_clients.discard(ws)
        logger.debug("Events WebSocket client disconnected")
