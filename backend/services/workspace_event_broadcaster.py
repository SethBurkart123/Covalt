from __future__ import annotations

import asyncio
import logging
from typing import Any

from .workspace_events import WorkspaceFilesChanged

logger = logging.getLogger(__name__)

_connected_clients: set[Any] = set()
_clients_lock = asyncio.Lock()


async def register_client(client: Any) -> None:
    async with _clients_lock:
        _connected_clients.add(client)


async def unregister_client(client: Any) -> None:
    async with _clients_lock:
        _connected_clients.discard(client)


async def broadcast_workspace_files_changed(event: WorkspaceFilesChanged) -> None:
    async with _clients_lock:
        disconnected: list[Any] = []
        for client in _connected_clients:
            try:
                if client.is_connected:
                    await client.send("workspace_files_changed", event)
            except Exception as e:
                logger.debug(f"Failed to send workspace change to client: {e}")
                disconnected.append(client)

        for client in disconnected:
            _connected_clients.discard(client)
