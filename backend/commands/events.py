"""
WebSocket event handler for real-time updates.

Provides a general-purpose WebSocket connection that broadcasts:
- MCP server status changes
- (Future: other app-wide events)

Uses zynk's @message decorator for typed WebSocket handling.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel
from zynk import WebSocket, message

from ..services.mcp_manager import get_mcp_manager, ServerStatus

logger = logging.getLogger(__name__)

_connected_clients: set["EventsWebSocket"] = set()
_clients_lock = asyncio.Lock()


class McpServerStatus(BaseModel):
    """Status update for a single MCP server."""

    id: str
    status: str  # "connecting" | "connected" | "error" | "disconnected"
    error: Optional[str] = None
    tool_count: int = 0


class McpServersSnapshot(BaseModel):
    """Full snapshot of all MCP servers."""

    servers: List[McpServerStatus]


class Ping(BaseModel):
    """Client ping to keep connection alive."""

    pass


class ServerEvents:
    """Events sent from server to client."""

    mcp_status: McpServerStatus
    mcp_servers: McpServersSnapshot


class ClientEvents:
    """Events sent from client to server."""

    ping: Ping


EventsWebSocket = WebSocket[ServerEvents, ClientEvents]


def _mcp_status_callback(
    server_id: str, status: ServerStatus, error: str | None, tool_count: int
) -> None:
    """Callback invoked by MCPManager on status changes."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(
                _broadcast_mcp_status(server_id, status, error, tool_count)
            )
    except RuntimeError:
        pass


async def _broadcast_mcp_status(
    server_id: str, status: str, error: str | None, tool_count: int
) -> None:
    """Broadcast MCP status change to all connected clients."""
    status_update = McpServerStatus(
        id=server_id,
        status=status,
        error=error,
        tool_count=tool_count,
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


def _get_mcp_servers_snapshot() -> McpServersSnapshot:
    """Get current snapshot of all MCP servers."""
    mcp = get_mcp_manager()
    servers = mcp.get_servers()

    return McpServersSnapshot(
        servers=[
            McpServerStatus(
                id=s["id"],
                status=s["status"],
                error=s.get("error"),
                tool_count=s.get("toolCount", 0),
            )
            for s in servers
        ]
    )


def _register_mcp_callback() -> None:
    """Register our callback with the MCP manager (idempotent)."""
    mcp = get_mcp_manager()
    mcp.add_status_callback(_mcp_status_callback)


@message
async def events(ws: EventsWebSocket) -> None:
    """
    WebSocket handler for real-time app events.

    On connect:
    - Sends current MCP server snapshot
    - Registers for status updates

    Broadcasts:
    - mcp_status: Individual server status changes
    - mcp_servers: Full server list (on connect)
    """
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

