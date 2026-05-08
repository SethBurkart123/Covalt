from __future__ import annotations

import asyncio
from collections import deque
from types import SimpleNamespace
from typing import Any

import pytest
from droid_sdk import (
    AssistantTextDelta,
    ThinkingTextDelta,
    TokenUsageUpdate,
    TurnComplete,
    WorkingStateChanged,
)
from droid_sdk.schemas.enums import DroidWorkingState

from backend.services.streaming.content_accumulator import (
    PROGRESS_HISTORY_CAP,
    ContentAccumulator,
)
from backend.services.streaming.runtime_events import (
    EVENT_STREAM_WARNING,
    EVENT_TOKEN_USAGE,
    EVENT_TOOL_CALL_PROGRESS,
    EVENT_TOOL_CALL_STARTED,
    EVENT_WORKING_STATE_CHANGED,
)
from nodes.core.droid_agent.executor import (
    _STREAM_DONE,
    _drain_response_stream,
    _make_stream_warning_event,
    _make_token_usage_event,
    _make_tool_call_progress_event,
    _make_working_state_event,
)


def _make_context() -> SimpleNamespace:
    return SimpleNamespace(node_id="droid-1", run_id="run-1", chat_id=None, services=None)


def test_tool_call_progress_appends_progress_entry() -> None:
    acc = ContentAccumulator()
    acc.apply_agent_event(
        {
            "event": EVENT_TOOL_CALL_STARTED,
            "tool": {"id": "t1", "toolName": "exec", "toolArgs": {"command": "ls"}},
        }
    )
    handled = acc.apply_agent_event(
        {
            "event": EVENT_TOOL_CALL_PROGRESS,
            "progress": {
                "toolCallId": "t1",
                "kind": "stdout",
                "detail": "hello\n",
                "progress": 0.5,
                "status": "running",
            },
        }
    )
    assert handled is True
    block = acc.find_tool_block(acc.content_blocks, "t1")
    assert block is not None
    progress = block.get("progress")
    assert isinstance(progress, list)
    assert len(progress) == 1
    assert progress[0]["kind"] == "stdout"
    assert progress[0]["detail"] == "hello\n"
    assert progress[0]["progress"] == 0.5
    assert progress[0]["status"] == "running"


def test_tool_call_progress_caps_history() -> None:
    acc = ContentAccumulator()
    acc.apply_agent_event(
        {
            "event": EVENT_TOOL_CALL_STARTED,
            "tool": {"id": "t1", "toolName": "exec", "toolArgs": {}},
        }
    )
    for i in range(PROGRESS_HISTORY_CAP + 50):
        acc.apply_agent_event(
            {
                "event": EVENT_TOOL_CALL_PROGRESS,
                "progress": {"toolCallId": "t1", "kind": "stdout", "detail": str(i)},
            }
        )
    block = acc.find_tool_block(acc.content_blocks, "t1")
    assert block is not None
    assert len(block["progress"]) == PROGRESS_HISTORY_CAP


def test_working_state_changed_updates_message_state() -> None:
    acc = ContentAccumulator()
    handled = acc.apply_agent_event(
        {"event": EVENT_WORKING_STATE_CHANGED, "state": "executing_tool"}
    )
    assert handled is True
    assert acc.message_state == "executing_tool"


def test_token_usage_updates_message_totals() -> None:
    acc = ContentAccumulator()
    handled = acc.apply_agent_event(
        {
            "event": EVENT_TOKEN_USAGE,
            "tokenUsage": {
                "inputTokens": 100,
                "outputTokens": 50,
                "cacheReadTokens": 5,
                "cacheWriteTokens": 10,
                "isMessageTotal": False,
            },
        }
    )
    assert handled is True
    assert acc.message_token_usage == {
        "inputTokens": 100,
        "outputTokens": 50,
        "cacheReadTokens": 5,
        "cacheWriteTokens": 10,
        "isMessageTotal": False,
    }


def test_stream_warning_emits_system_event_block() -> None:
    acc = ContentAccumulator()
    handled = acc.apply_agent_event(
        {
            "event": EVENT_STREAM_WARNING,
            "warning": {"message": "reconnecting", "level": "warning"},
        }
    )
    assert handled is True
    assert any(b.get("type") == "system_event" for b in acc.content_blocks)
    block = acc.content_blocks[-1]
    assert block["content"] == "reconnecting"
    assert block["level"] == "warning"


def test_translation_helpers_produce_expected_payloads() -> None:
    ctx = _make_context()

    progress_event = _make_tool_call_progress_event(
        ctx,
        tool_call_id="abc",
        tool_name="exec",
        detail="line",
        kind="stdout",
        progress=0.5,
        status="running",
    )
    assert progress_event.data["event"] == "ToolCallProgress"
    assert progress_event.data["progress"]["toolCallId"] == "abc"
    assert progress_event.data["progress"]["kind"] == "stdout"

    state_event = _make_working_state_event(ctx, "executing_tool")
    assert state_event.data["event"] == "WorkingStateChanged"
    assert state_event.data["state"] == "executing_tool"

    token_event = _make_token_usage_event(
        ctx, input_tokens=10, output_tokens=5, cache_read_tokens=1, cache_write_tokens=2
    )
    assert token_event.data["event"] == "TokenUsage"
    assert token_event.data["tokenUsage"]["inputTokens"] == 10

    warning_event = _make_stream_warning_event(ctx, message="oops", level="warning")
    assert warning_event.data["event"] == "StreamWarning"
    assert warning_event.data["warning"]["message"] == "oops"


@pytest.mark.asyncio
async def test_drain_stream_auto_closes_reasoning_on_text_delta() -> None:
    class _FakeClient:
        async def receive_response(self):
            yield ThinkingTextDelta(text="thinking…")
            yield AssistantTextDelta(text="answer")
            yield TurnComplete()

    queue: asyncio.Queue[Any] = asyncio.Queue()
    ctx = _make_context()
    await _drain_response_stream(
        client=_FakeClient(),
        context=ctx,
        queue=queue,
        content_parts=[],
        tool_name_by_id={},
        pending_result_ids=deque(),
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())

    sentinel = events.pop()
    assert sentinel is _STREAM_DONE

    event_names = [e.data.get("event") if hasattr(e, "data") else e.event_type for e in events]
    started_idx = event_names.index("ReasoningStarted")
    completed_idx = event_names.index("ReasoningCompleted")
    progress_idx = next(i for i, e in enumerate(events) if getattr(e, "event_type", "") == "progress")
    assert started_idx < completed_idx < progress_idx


@pytest.mark.asyncio
async def test_drain_stream_emits_token_usage_and_state_events() -> None:
    class _FakeClient:
        async def receive_response(self):
            yield WorkingStateChanged(state=DroidWorkingState.ExecutingTool)
            yield TokenUsageUpdate(
                input_tokens=100,
                output_tokens=50,
                cache_read_tokens=5,
                cache_write_tokens=10,
            )
            yield TurnComplete()

    queue: asyncio.Queue[Any] = asyncio.Queue()
    ctx = _make_context()
    await _drain_response_stream(
        client=_FakeClient(),
        context=ctx,
        queue=queue,
        content_parts=[],
        tool_name_by_id={},
        pending_result_ids=deque(),
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())
    events.pop()

    event_names = [e.data.get("event") for e in events]
    assert "WorkingStateChanged" in event_names
    assert "TokenUsage" in event_names
