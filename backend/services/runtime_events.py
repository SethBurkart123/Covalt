from __future__ import annotations

import logging
from typing import Any

from zynk import Channel

from ..models.chat import ChatEvent

logger = logging.getLogger(__name__)

EVENT_RUN_STARTED = "RunStarted"
EVENT_ASSISTANT_MESSAGE_ID = "AssistantMessageId"
EVENT_RUN_CONTENT = "RunContent"
EVENT_SEED_BLOCKS = "SeedBlocks"
EVENT_REASONING_STARTED = "ReasoningStarted"
EVENT_REASONING_STEP = "ReasoningStep"
EVENT_REASONING_COMPLETED = "ReasoningCompleted"
EVENT_TOOL_CALL_STARTED = "ToolCallStarted"
EVENT_TOOL_CALL_COMPLETED = "ToolCallCompleted"
EVENT_TOOL_APPROVAL_REQUIRED = "ToolApprovalRequired"
EVENT_TOOL_APPROVAL_RESOLVED = "ToolApprovalResolved"
EVENT_MEMBER_RUN_STARTED = "MemberRunStarted"
EVENT_MEMBER_RUN_COMPLETED = "MemberRunCompleted"
EVENT_MEMBER_RUN_ERROR = "MemberRunError"
EVENT_FLOW_NODE_STARTED = "FlowNodeStarted"
EVENT_FLOW_NODE_COMPLETED = "FlowNodeCompleted"
EVENT_FLOW_NODE_RESULT = "FlowNodeResult"
EVENT_FLOW_NODE_ERROR = "FlowNodeError"
EVENT_RUN_COMPLETED = "RunCompleted"
EVENT_RUN_CANCELLED = "RunCancelled"
EVENT_RUN_ERROR = "RunError"
EVENT_STREAM_NOT_ACTIVE = "StreamNotActive"
EVENT_STREAM_SUBSCRIBED = "StreamSubscribed"

KNOWN_RUNTIME_EVENTS: frozenset[str] = frozenset(
    {
        EVENT_RUN_STARTED,
        EVENT_ASSISTANT_MESSAGE_ID,
        EVENT_RUN_CONTENT,
        EVENT_SEED_BLOCKS,
        EVENT_REASONING_STARTED,
        EVENT_REASONING_STEP,
        EVENT_REASONING_COMPLETED,
        EVENT_TOOL_CALL_STARTED,
        EVENT_TOOL_CALL_COMPLETED,
        EVENT_TOOL_APPROVAL_REQUIRED,
        EVENT_TOOL_APPROVAL_RESOLVED,
        EVENT_MEMBER_RUN_STARTED,
        EVENT_MEMBER_RUN_COMPLETED,
        EVENT_MEMBER_RUN_ERROR,
        EVENT_FLOW_NODE_STARTED,
        EVENT_FLOW_NODE_COMPLETED,
        EVENT_FLOW_NODE_RESULT,
        EVENT_FLOW_NODE_ERROR,
        EVENT_RUN_COMPLETED,
        EVENT_RUN_CANCELLED,
        EVENT_RUN_ERROR,
        EVENT_STREAM_NOT_ACTIVE,
        EVENT_STREAM_SUBSCRIBED,
    }
)

_WARNED_UNKNOWN_EVENTS: set[str] = set()


def is_known_runtime_event(event: str) -> bool:
    return event in KNOWN_RUNTIME_EVENTS


def _validate_runtime_event(event: str, *, allow_unknown: bool = False) -> str:
    if not isinstance(event, str) or not event.strip():
        raise ValueError("Runtime event must be a non-empty string")

    if allow_unknown or is_known_runtime_event(event):
        return event

    if event not in _WARNED_UNKNOWN_EVENTS:
        _WARNED_UNKNOWN_EVENTS.add(event)
        logger.warning("[runtime_events] Unknown runtime event emitted: %s", event)

    return event


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
