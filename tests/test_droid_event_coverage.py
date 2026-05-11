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
    _build_session_plan,
    _display_path,
    _drain_response_stream,
    _droid_tool_payload,
    _DroidSessionCheckpoint,
    _DroidSessionPlan,
    _fork_droid_session,
    _make_stream_warning_event,
    _make_token_usage_event,
    _make_tool_call_progress_event,
    _make_working_state_event,
    _resume_or_initialize_session,
)


def _make_context() -> SimpleNamespace:
    return SimpleNamespace(node_id="droid-1", run_id="run-1", chat_id=None, services=None)


def test_droid_display_path_uses_relative_path_only_near_cwd() -> None:
    assert _display_path("/repo/current/file.py", "/repo/current") == "file.py"
    assert _display_path("/repo/other/file.py", "/repo/current") == "../other/file.py"
    assert _display_path("/repo/file.py", "/repo/current/deep") == "/repo/file.py"
    assert _display_path("../already-relative.py", "/repo/current") == "../already-relative.py"


def test_droid_tool_payload_formats_display_path_args_only() -> None:
    payload = _droid_tool_payload(
        tool_id="read-1",
        tool_name="Read",
        tool_args={
            "file_path": "/repo/other/file.py",
            "command": "cat /repo/current/file.py",
        },
        cwd="/repo/current",
        is_completed=False,
    )

    assert payload["toolArgs"] == {
        "file_path": "../other/file.py",
        "command": "cat /repo/current/file.py",
    }


def _make_chat_context(
    *,
    message_path_ids: list[str],
    assistant_message_id: str,
    conversation_run_mode: str = "branch",
) -> SimpleNamespace:
    return SimpleNamespace(
        node_id="droid-1",
        run_id="run-1",
        chat_id="chat-1",
        services=SimpleNamespace(
            chat_input=SimpleNamespace(
                message_path_ids=message_path_ids,
                assistant_message_id=assistant_message_id,
                conversation_run_mode=conversation_run_mode,
            )
        ),
    )


def test_droid_session_plan_uses_selected_branch_path(monkeypatch) -> None:
    sessions = {
        "assistant-before-edit": _DroidSessionCheckpoint("session-before-edit", 4),
        "assistant-old-sibling": _DroidSessionCheckpoint("session-old-sibling", 9),
    }

    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._latest_droid_checkpoint_for_message",
        lambda message_id, **_kwargs: sessions.get(message_id),
    )

    context = _make_chat_context(
        message_path_ids=["user-1", "assistant-before-edit", "user-edited"],
        assistant_message_id="assistant-new-branch",
    )

    plan = _build_session_plan(context)

    assert plan.current_session_id is None
    assert plan.source_session_id == "session-before-edit"
    assert plan.source_line_count == 4


def test_droid_session_plan_prefers_current_assistant_session(monkeypatch) -> None:
    sessions = {
        "assistant-parent": "session-parent",
        "assistant-current": "session-current",
    }

    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._latest_droid_session_for_message",
        lambda message_id, **_kwargs: sessions.get(message_id),
    )

    context = _make_chat_context(
        message_path_ids=["user-1", "assistant-parent", "user-2"],
        assistant_message_id="assistant-current",
    )

    plan = _build_session_plan(context)

    assert plan.current_session_id == "session-current"
    assert plan.source_session_id == "session-parent"


def test_droid_session_plan_continues_source_session_for_linear_turn(monkeypatch) -> None:
    sessions = {"assistant-parent": "session-parent"}

    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._latest_droid_session_for_message",
        lambda message_id, **_kwargs: sessions.get(message_id),
    )

    context = _make_chat_context(
        message_path_ids=["user-1", "assistant-parent", "user-2"],
        assistant_message_id="assistant-current",
        conversation_run_mode="continue",
    )

    plan = _build_session_plan(context)

    assert plan.current_session_id == "session-parent"
    assert plan.source_session_id == "session-parent"


@pytest.mark.asyncio
async def test_resume_or_initialize_loads_storage_fork_for_branch(monkeypatch) -> None:
    class FakeInitResult:
        session_id = "session-child"

    class FakeClient:
        def __init__(self) -> None:
            self.loaded: list[str] = []
            self.initialized: list[dict[str, Any]] = []
            self.settings: list[dict[str, Any]] = []

        async def load_session(self, *, session_id: str) -> None:
            self.loaded.append(session_id)

        async def initialize_session(self, **kwargs: Any) -> FakeInitResult:
            self.initialized.append(kwargs)
            return FakeInitResult()

        async def update_session_settings(self, **kwargs: Any) -> None:
            self.settings.append(kwargs)

    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._build_session_plan",
        lambda _context: _DroidSessionPlan(
            cache_key="chat-1:droid-1:assistant-new",
            source_session_id="session-parent",
        ),
    )
    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._fork_droid_session",
        lambda _cwd, _source_session_id, *, line_count=None: "session-fork",
    )

    context = _make_chat_context(
        message_path_ids=["user-1", "assistant-parent", "user-2"],
        assistant_message_id="assistant-new",
    )
    client = FakeClient()

    session_id = await _resume_or_initialize_session(
        client,
        context=context,
        cwd="/repo",
        model_id="",
        autonomy=None,
        reasoning=None,
        interaction_mode=None,
    )

    assert session_id == "session-fork"
    assert client.loaded == ["session-fork"]
    assert client.initialized == []


@pytest.mark.asyncio
async def test_resume_or_initialize_uses_minimal_initialize_when_no_source(monkeypatch) -> None:
    class FakeInitResult:
        session_id = "session-child"

    class FakeClient:
        def __init__(self) -> None:
            self.loaded: list[str] = []
            self.initialized: list[dict[str, Any]] = []

        async def load_session(self, *, session_id: str) -> None:
            self.loaded.append(session_id)

        async def initialize_session(self, **kwargs: Any) -> FakeInitResult:
            self.initialized.append(kwargs)
            return FakeInitResult()

        async def update_session_settings(self, **kwargs: Any) -> None:
            pass

    monkeypatch.setattr(
        "nodes.core.droid_agent.executor._build_session_plan",
        lambda _context: _DroidSessionPlan(
            cache_key="chat-1:droid-1:assistant-new-without-source",
        ),
    )

    client = FakeClient()
    session_id = await _resume_or_initialize_session(
        client,
        context=_make_chat_context(
            message_path_ids=[],
            assistant_message_id="assistant-new",
        ),
        cwd="/repo",
        model_id="",
        autonomy=None,
        reasoning=None,
        interaction_mode=None,
    )

    assert session_id == "session-child"
    assert client.initialized == [{"machine_id": "covalt", "cwd": "/repo"}]


def test_fork_droid_session_copies_jsonl_and_settings(tmp_path, monkeypatch) -> None:
    cwd = "/repo"
    session_id = "source-session"
    session_dir = tmp_path / ".factory" / "sessions" / cwd.replace("/", "-")
    session_dir.mkdir(parents=True)
    source_path = session_dir / f"{session_id}.jsonl"
    source_path.write_text(
        "\n".join(
            [
                json.dumps({"type": "session_start", "id": session_id, "cwd": cwd}),
                json.dumps({"type": "message", "message": {"content": "hello"}}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    settings_path = session_dir / f"{session_id}.settings.json"
    settings_path.write_text('{"model":"gpt-5.5"}', encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    forked_id = _fork_droid_session(cwd, session_id)

    assert forked_id is not None
    forked_path = session_dir / f"{forked_id}.jsonl"
    assert forked_path.exists()
    rows = [json.loads(line) for line in forked_path.read_text().splitlines()]
    assert rows[0]["id"] == forked_id
    assert rows[1]["message"]["content"] == "hello"
    copied_settings = session_dir / f"{forked_id}.settings.json"
    assert copied_settings.read_text() == '{"model":"gpt-5.5"}'


def test_fork_droid_session_truncates_to_checkpoint(tmp_path, monkeypatch) -> None:
    cwd = "/repo"
    session_id = "source-session"
    session_dir = tmp_path / ".factory" / "sessions" / cwd.replace("/", "-")
    session_dir.mkdir(parents=True)
    source_path = session_dir / f"{session_id}.jsonl"
    source_path.write_text(
        "\n".join(
            [
                json.dumps({"type": "session_start", "id": session_id, "cwd": cwd}),
                json.dumps({"type": "message", "message": {"content": "prior"}}),
                json.dumps({"type": "message", "message": {"content": "cats"}}),
                json.dumps({"type": "message", "message": {"content": "cats reply"}}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    forked_id = _fork_droid_session(cwd, session_id, line_count=2)

    assert forked_id is not None
    forked_path = session_dir / f"{forked_id}.jsonl"
    rows = [json.loads(line) for line in forked_path.read_text().splitlines()]
    assert [row.get("message", {}).get("content") for row in rows] == [None, "prior"]
    assert rows[0]["id"] == forked_id


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
