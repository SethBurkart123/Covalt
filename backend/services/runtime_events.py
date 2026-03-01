from __future__ import annotations

import logging
from typing import Any

from zynk import Channel

from ..models.chat import ChatEvent
from .runtime_event_contract import (
    KNOWN_RUNTIME_EVENTS as CONTRACT_KNOWN_RUNTIME_EVENTS,
    RUNTIME_EVENT_BY_KEY,
    RUNTIME_EVENT_CONTRACT_VERSION as CONTRACT_RUNTIME_EVENT_CONTRACT_VERSION,
)

logger = logging.getLogger(__name__)

EVENT_RUN_STARTED = RUNTIME_EVENT_BY_KEY["RUN_STARTED"]
EVENT_ASSISTANT_MESSAGE_ID = RUNTIME_EVENT_BY_KEY["ASSISTANT_MESSAGE_ID"]
EVENT_RUN_CONTENT = RUNTIME_EVENT_BY_KEY["RUN_CONTENT"]
EVENT_SEED_BLOCKS = RUNTIME_EVENT_BY_KEY["SEED_BLOCKS"]
EVENT_REASONING_STARTED = RUNTIME_EVENT_BY_KEY["REASONING_STARTED"]
EVENT_REASONING_STEP = RUNTIME_EVENT_BY_KEY["REASONING_STEP"]
EVENT_REASONING_COMPLETED = RUNTIME_EVENT_BY_KEY["REASONING_COMPLETED"]
EVENT_TOOL_CALL_STARTED = RUNTIME_EVENT_BY_KEY["TOOL_CALL_STARTED"]
EVENT_TOOL_CALL_COMPLETED = RUNTIME_EVENT_BY_KEY["TOOL_CALL_COMPLETED"]
EVENT_TOOL_CALL_FAILED = RUNTIME_EVENT_BY_KEY["TOOL_CALL_FAILED"]
EVENT_TOOL_CALL_ERROR = RUNTIME_EVENT_BY_KEY["TOOL_CALL_ERROR"]
EVENT_TOOL_APPROVAL_REQUIRED = RUNTIME_EVENT_BY_KEY["TOOL_APPROVAL_REQUIRED"]
EVENT_TOOL_APPROVAL_RESOLVED = RUNTIME_EVENT_BY_KEY["TOOL_APPROVAL_RESOLVED"]
EVENT_MEMBER_RUN_STARTED = RUNTIME_EVENT_BY_KEY["MEMBER_RUN_STARTED"]
EVENT_MEMBER_RUN_COMPLETED = RUNTIME_EVENT_BY_KEY["MEMBER_RUN_COMPLETED"]
EVENT_MEMBER_RUN_ERROR = RUNTIME_EVENT_BY_KEY["MEMBER_RUN_ERROR"]
EVENT_FLOW_NODE_STARTED = RUNTIME_EVENT_BY_KEY["FLOW_NODE_STARTED"]
EVENT_FLOW_NODE_COMPLETED = RUNTIME_EVENT_BY_KEY["FLOW_NODE_COMPLETED"]
EVENT_FLOW_NODE_RESULT = RUNTIME_EVENT_BY_KEY["FLOW_NODE_RESULT"]
EVENT_FLOW_NODE_ERROR = RUNTIME_EVENT_BY_KEY["FLOW_NODE_ERROR"]
EVENT_RUN_COMPLETED = RUNTIME_EVENT_BY_KEY["RUN_COMPLETED"]
EVENT_RUN_CANCELLED = RUNTIME_EVENT_BY_KEY["RUN_CANCELLED"]
EVENT_RUN_ERROR = RUNTIME_EVENT_BY_KEY["RUN_ERROR"]
EVENT_STREAM_NOT_ACTIVE = RUNTIME_EVENT_BY_KEY["STREAM_NOT_ACTIVE"]
EVENT_STREAM_SUBSCRIBED = RUNTIME_EVENT_BY_KEY["STREAM_SUBSCRIBED"]

RUNTIME_EVENT_CONTRACT_VERSION = CONTRACT_RUNTIME_EVENT_CONTRACT_VERSION
KNOWN_RUNTIME_EVENTS: frozenset[str] = CONTRACT_KNOWN_RUNTIME_EVENTS

_WARNED_UNKNOWN_EVENTS: set[str] = set()


def is_known_runtime_event(event: str) -> bool:
    return event in KNOWN_RUNTIME_EVENTS


def _validate_runtime_event(event: str, *, allow_unknown: bool = False) -> str:
    if not isinstance(event, str) or not event.strip():
        raise ValueError("Runtime event must be a non-empty string")

    if is_known_runtime_event(event):
        return event

    if allow_unknown:
        if event not in _WARNED_UNKNOWN_EVENTS:
            _WARNED_UNKNOWN_EVENTS.add(event)
            logger.warning("[runtime_events] Unknown runtime event emitted: %s", event)
        return event

    raise ValueError(f"Unknown runtime event: {event}")


def make_chat_event(
    event: str,
    *,
    allow_unknown: bool = False,
    **payload: Any,
) -> ChatEvent:
    event_name = _validate_runtime_event(event, allow_unknown=allow_unknown)
    return ChatEvent(event=event_name, **payload)


def emit_chat_event(
    channel: Channel,
    event: str,
    *,
    allow_unknown: bool = False,
    **payload: Any,
) -> None:
    channel.send_model(make_chat_event(event, allow_unknown=allow_unknown, **payload))

