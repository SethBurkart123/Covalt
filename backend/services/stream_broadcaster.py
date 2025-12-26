"""
Stream Broadcaster - Pub/Sub system for multi-frontend stream support.

This module allows multiple frontend clients to subscribe to the same
streaming chat session and receive real-time updates.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional, Set

from ..db.core import db_session
from ..db.models import ActiveStream


@dataclass
class StreamSubscription:
    """Represents a subscriber's connection to a stream."""

    queue: asyncio.Queue
    subscribed_at: datetime = field(default_factory=datetime.now)


@dataclass
class StreamState:
    """Tracks the state of an active stream."""

    chat_id: str
    message_id: str
    run_id: Optional[str] = None
    status: str = "streaming"  # streaming, paused_hitl, completed, error, interrupted
    subscribers: Set[asyncio.Queue] = field(default_factory=set)
    # Keep recent events for late-joiners to catch up (last N events)
    recent_events: deque = field(default_factory=lambda: deque(maxlen=100))
    error_message: Optional[str] = None


# Global registry of active streams
_active_streams: Dict[str, StreamState] = {}
_lock = asyncio.Lock()


async def register_stream(
    chat_id: str, message_id: str, run_id: Optional[str] = None
) -> None:
    """
    Register a new streaming session.
    Called when a stream_chat/retry_message/etc. starts.
    """
    async with _lock:
        now = datetime.now().isoformat()

        _active_streams[chat_id] = StreamState(
            chat_id=chat_id,
            message_id=message_id,
            run_id=run_id,
            status="streaming",
        )

        # Persist to database
        with db_session() as session:
            existing = session.get(ActiveStream, chat_id)
            if existing:
                session.delete(existing)

            stream_record = ActiveStream(
                chat_id=chat_id,
                message_id=message_id,
                run_id=run_id,
                status="streaming",
                started_at=now,
                updated_at=now,
            )
            session.add(stream_record)
            session.commit()


async def update_stream_run_id(chat_id: str, run_id: str) -> None:
    """Update the run_id for a stream (set after agent.arun starts)."""
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].run_id = run_id

        with db_session() as session:
            stream = session.get(ActiveStream, chat_id)
            if stream:
                stream.run_id = run_id
                stream.updated_at = datetime.now().isoformat()
                session.commit()


async def update_stream_status(
    chat_id: str, status: str, error_message: Optional[str] = None
) -> None:
    """
    Update stream status.
    Status can be: streaming, paused_hitl, completed, error, interrupted
    """
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].status = status
            _active_streams[chat_id].error_message = error_message

        with db_session() as session:
            stream = session.get(ActiveStream, chat_id)
            if stream:
                stream.status = status
                stream.error_message = error_message
                stream.updated_at = datetime.now().isoformat()
                session.commit()


async def unregister_stream(chat_id: str) -> None:
    """
    Remove a stream from the registry.
    Called when stream completes, errors, or is cancelled.
    
    Note: RunCompleted should be sent via broadcast_event BEFORE calling this,
    since this removes the subscribers.
    """
    async with _lock:
        if chat_id in _active_streams:
            state = _active_streams[chat_id]
            
            for queue in state.subscribers:
                try:
                    queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass
            
            del _active_streams[chat_id]

        with db_session() as session:
            stream = session.get(ActiveStream, chat_id)
            if stream:
                session.delete(stream)
                session.commit()


async def broadcast_event(chat_id: str, event: Dict[str, Any]) -> None:
    """
    Broadcast an event to all subscribers of a chat's stream.
    """
    async with _lock:
        if chat_id not in _active_streams:
            return

        state = _active_streams[chat_id]

        state.recent_events.append(event)

        with db_session() as session:
            stream = session.get(ActiveStream, chat_id)
            if stream:
                stream.updated_at = datetime.now().isoformat()
                session.commit()

        dead_queues = set()
        for queue in state.subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead_queues.add(queue)

        state.subscribers -= dead_queues


async def subscribe(chat_id: str) -> Optional[asyncio.Queue]:
    """
    Subscribe to events for a chat's stream.
    Returns a queue that receives events, or None if no active stream.
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
        return queue


async def unsubscribe(chat_id: str, queue: asyncio.Queue) -> None:
    """
    Unsubscribe from a chat's stream.
    """
    async with _lock:
        if chat_id in _active_streams:
            _active_streams[chat_id].subscribers.discard(queue)


def get_stream_state(chat_id: str) -> Optional[StreamState]:
    """Get the current state of a stream (non-async for simple checks)."""
    return _active_streams.get(chat_id)


def is_stream_active(chat_id: str) -> bool:
    """Check if a chat has an active stream."""
    state = _active_streams.get(chat_id)
    return state is not None and state.status in ("streaming", "paused_hitl")


async def get_all_active_streams() -> list[Dict[str, Any]]:
    """
    Get all active streams (for frontend initialization).
    Returns both in-memory active streams and DB records for interrupted streams.
    """
    result = []

    async with _lock:
        for chat_id, state in _active_streams.items():
            result.append(
                {
                    "chatId": chat_id,
                    "messageId": state.message_id,
                    "status": state.status,
                    "errorMessage": state.error_message,
                }
            )

    with db_session() as session:
        db_streams = session.query(ActiveStream).all()
        existing_chat_ids = {s["chatId"] for s in result}

        for stream in db_streams:
            if stream.chat_id not in existing_chat_ids:
                result.append(
                    {
                        "chatId": stream.chat_id,
                        "messageId": stream.message_id,
                        "status": stream.status,
                        "errorMessage": stream.error_message,
                    }
                )

    return result


async def clear_stream_record(chat_id: str) -> None:
    """
    Remove a stream record from the database entirely.
    Called when user acknowledges an interrupted/error stream.
    """
    with db_session() as session:
        stream = session.get(ActiveStream, chat_id)
        if stream:
            session.delete(stream)
            session.commit()
