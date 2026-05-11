from __future__ import annotations

import asyncio
import json
from collections import deque
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from droid_sdk import (
    AssistantTextDelta,
    ThinkingTextDelta,
    TokenUsageUpdate,
    ToolProgress,
    ToolResult,
    ToolUse,
    TurnComplete,
    WorkingStateChanged,
)
from droid_sdk.schemas.cli import ToolProgressUpdateNotification
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


def test_member_working_state_updates_member_preview_state() -> None:
    acc = ContentAccumulator()
    acc.apply_agent_event(
        {
            "event": "MemberRunStarted",
            "memberRunId": "member-1",
            "memberName": "Worker",
        }
    )
    handled = acc.apply_agent_event(
        {
            "event": EVENT_WORKING_STATE_CHANGED,
            "memberRunId": "member-1",
            "memberName": "Worker",
            "state": "executing",
        }
    )
    assert handled is True
    assert acc.message_state is None
    assert acc.content_blocks[0]["state"] == "executing"


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
        tool_args_by_id={},
        pending_progress=deque(),
        pending_result_ids=deque(),
        cwd="/tmp",
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
        tool_args_by_id={},
        pending_progress=deque(),
        pending_result_ids=deque(),
        cwd="/tmp",
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())
    events.pop()

    event_names = [e.data.get("event") for e in events]
    assert "WorkingStateChanged" in event_names
    assert "TokenUsage" in event_names


@pytest.mark.asyncio
async def test_drain_stream_maps_droid_task_to_member_run() -> None:
    class _FakeClient:
        async def receive_response(self):
            yield ToolUse(
                tool_name="Task",
                tool_input={
                    "description": "Review frontend renderers",
                    "subagent_type": "worker",
                    "prompt": "Check the UI.",
                },
                tool_use_id="task-1",
            )
            yield ToolProgress(tool_name="Task", content="Reading files")
            yield ToolResult(
                tool_name="",
                content="session_id: 00000000-0000-0000-0000-000000000000 done",
                is_error=False,
            )
            yield TurnComplete()

    progress = ToolProgressUpdateNotification.model_validate(
        {
            "type": "tool_progress_update",
            "toolUseId": "task-1",
            "toolName": "Task",
            "update": {
                "type": "message",
                "text": "Reading files",
            },
        }
    )
    queue: asyncio.Queue[Any] = asyncio.Queue()
    ctx = _make_context()
    await _drain_response_stream(
        client=_FakeClient(),
        context=ctx,
        queue=queue,
        content_parts=[],
        tool_name_by_id={},
        tool_args_by_id={},
        pending_progress=deque([progress]),
        pending_result_ids=deque(["task-1"]),
        cwd="/tmp",
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())
    events.pop()

    event_names = [e.data.get("event") for e in events]
    assert event_names == [
        "MemberRunStarted",
        "RunContent",
        "RunContent",
        "MemberRunCompleted",
    ]
    assert events[0].data["memberName"] == "Review frontend renderers"
    assert events[0].data["task"] == "Check the UI."
    assert events[1].data["content"] == "Reading files"
    assert events[2].data["content"] == "done"


@pytest.mark.asyncio
async def test_drain_stream_completes_droid_task_child_tools_with_outputs() -> None:
    class _FakeClient:
        async def receive_response(self):
            yield ToolUse(
                tool_name="Task",
                tool_input={"description": "Review frontend", "prompt": "Inspect files"},
                tool_use_id="task-1",
            )
            yield ToolProgress(tool_name="Task", content="Read")
            yield ToolProgress(tool_name="Task", content="Read complete")
            yield ToolResult(tool_name="", content="", is_error=False)
            yield TurnComplete()

    progress = [
        ToolProgressUpdateNotification.model_validate(
            {
                "type": "tool_progress_update",
                "toolUseId": "task-1",
                "toolName": "Task",
                "update": {
                    "type": "tool_call",
                    "toolName": "Read",
                    "parameters": {"file_path": "README.md"},
                },
            }
        ),
        ToolProgressUpdateNotification.model_validate(
            {
                "type": "tool_progress_update",
                "toolUseId": "task-1",
                "toolName": "Task",
                "update": {
                    "type": "tool_result",
                    "toolName": "Read",
                    "text": "README contents",
                },
            }
        ),
    ]
    queue: asyncio.Queue[Any] = asyncio.Queue()
    ctx = _make_context()
    await _drain_response_stream(
        client=_FakeClient(),
        context=ctx,
        queue=queue,
        content_parts=[],
        tool_name_by_id={},
        tool_args_by_id={},
        pending_progress=deque(progress),
        pending_result_ids=deque(["task-1"]),
        cwd="/tmp",
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())
    events.pop()

    tool_events = [event for event in events if event.data.get("event", "").startswith("ToolCall")]
    assert [event.data["event"] for event in tool_events] == [
        "ToolCallStarted",
        "ToolCallCompleted",
    ]
    assert tool_events[0].data["tool"]["toolArgs"] == {"file_path": "README.md"}
    assert tool_events[1].data["tool"]["toolArgs"] == {"file_path": "README.md"}
    assert tool_events[1].data["tool"]["toolResult"] == "README contents"


@pytest.mark.asyncio
async def test_drain_stream_backfills_droid_task_session_tool_results(
    tmp_path, monkeypatch
) -> None:
    session_id = "e22623b6-ebc1-40f9-a8c6-496e938ea1d1"
    cwd = "/repo"
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    session_dir = tmp_path / ".factory" / "sessions" / cwd.replace("/", "-")
    session_dir.mkdir(parents=True)
    session_file = session_dir / f"{session_id}.jsonl"
    session_file.write_text(
        "\n".join(
            json.dumps(item)
            for item in [
                {
                    "type": "message",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "read-1",
                                "name": "Read",
                                "input": {"file_path": "README.md"},
                            }
                        ],
                    },
                },
                {
                    "type": "message",
                    "message": {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "read-1",
                                "is_error": False,
                                "content": "README contents",
                            }
                        ],
                    },
                },
                {
                    "type": "message",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "ls-1",
                                "name": "LS",
                                "input": {"directory_path": "."},
                            }
                        ],
                    },
                },
                {
                    "type": "message",
                    "message": {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "ls-1",
                                "is_error": False,
                                "content": "README.md",
                            }
                        ],
                    },
                },
                {
                    "type": "message",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "pending-1",
                                "name": "Read",
                                "input": {"file_path": "pending.md"},
                            }
                        ],
                    },
                },
            ]
        ),
        encoding="utf-8",
    )

    class _FakeClient:
        async def receive_response(self):
            yield ToolUse(
                tool_name="Task",
                tool_input={"description": "Explore", "prompt": "Look around"},
                tool_use_id="task-1",
            )
            yield ToolProgress(tool_name="Task", content="Read")
            yield ToolResult(
                tool_name="",
                content=f"session_id: {session_id}\nFinal result",
                is_error=False,
            )
            yield TurnComplete()

    progress = ToolProgressUpdateNotification.model_validate(
        {
            "type": "tool_progress_update",
            "toolUseId": "task-1",
            "toolName": "Task",
            "update": {
                "type": "tool_call",
                "toolName": "Read",
                "parameters": {"file_path": "README.md"},
                "subagentSessionId": session_id,
            },
        }
    )
    queue: asyncio.Queue[Any] = asyncio.Queue()
    await _drain_response_stream(
        client=_FakeClient(),
        context=_make_context(),
        queue=queue,
        content_parts=[],
        tool_name_by_id={},
        tool_args_by_id={},
        pending_progress=deque([progress]),
        pending_result_ids=deque(["task-1"]),
        cwd=cwd,
    )

    events: list[Any] = []
    while not queue.empty():
        events.append(queue.get_nowait())
    events.pop()

    tool_events = [event for event in events if event.data.get("event", "").startswith("ToolCall")]
    assert [event.data["event"] for event in tool_events] == [
        "ToolCallStarted",
        "ToolCallCompleted",
        "ToolCallStarted",
        "ToolCallCompleted",
    ]
    assert tool_events[1].data["tool"]["toolResult"] == "README contents"
    assert tool_events[3].data["tool"]["toolName"] == "LS"
    assert tool_events[3].data["tool"]["toolResult"] == "README.md"
