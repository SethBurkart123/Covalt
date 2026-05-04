"""Pub/Sub system for multi-frontend stream support.

In-memory only -- no DB persistence. On process restart all streams are gone
(they can't resume anyway).
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StreamState:
    chat_id: str
    message_id: str
    run_id: str | None = None
    status: str = "streaming"
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    recent_events: deque = field(default_factory=lambda: deque(maxlen=100))
    error_message: str | None = None


@dataclass
class SubscribeResult:
    """Returned by get_or_subscribe so the caller gets state + queue atomically."""
    status: str
    message_id: str
    error_message: str | None
    queue: asyncio.Queue


_active_streams: dict[str, StreamState] = {}
_lock = asyncio.Lock()


async def register_stream(
    chat_id: str, message_id: str, run_id: str | None = None
) -> None:
    async with _lock:
        _active_streams[chat_id] = StreamState(
            chat_id=chat_id,
            message_id=message_id,
            run_id=run_id,
            status="streaming",
        )


async def update_stream_run_id(chat_id: str, run_id: str) -> None:
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].run_id = run_id


async def update_stream_status(
    chat_id: str, status: str, error_message: str | None = None
) -> None:
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].status = status
            _active_streams[chat_id].error_message = error_message


async def unregister_stream(chat_id: str) -> None:
    async with _lock:
        if chat_id in _active_streams:
            state = _active_streams[chat_id]

            for queue in state.subscribers:
                try:
                    queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass

            del _active_streams[chat_id]


async def broadcast_event(chat_id: str, event: dict[str, Any]) -> None:
    async with _lock:
        if chat_id not in _active_streams:
            return

        state = _active_streams[chat_id]
        state.recent_events.append(event)

        dead_queues = set()
        for queue in state.subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead_queues.add(queue)

        state.subscribers -= dead_queues


async def get_or_subscribe(chat_id: str) -> SubscribeResult | None:
    """Atomically check if a stream exists and subscribe in one call.

    Returns None if no active stream for this chatId.
    """
    async with _lock:
        if chat_id not in _active_streams:
            return None

        state = _active_streams[chat_id]
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

        for event in state.recent_events:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                break

        state.subscribers.add(queue)
        return SubscribeResult(
            status=state.status,
            message_id=state.message_id,
            error_message=state.error_message,
            queue=queue,
        )



async def unsubscribe(chat_id: str, queue: asyncio.Queue) -> None:
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].subscribers.discard(queue)
