"""Characterization tests for current chat streaming event behavior.

These tests intentionally lock today's `handle_content_stream` event protocol
at the runtime adapter boundary. They should fail if event ordering or payload
wiring changes unexpectedly.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest

import backend.services.chat_graph_runner as chat_graph_runner_module
from backend.models.chat import ChatMessage
from backend.runtime import (
    ApprovalRequired,
    ApprovalResolved,
    ApprovalResponse,
    ContentDelta,
    PendingApproval,
    RunCompleted,
    RuntimeEventT,
    RuntimeToolCall,
    RuntimeToolResult,
    ToolCallCompleted,
    ToolCallStarted,
)
from backend.services import run_control
from backend.services.chat_graph_runner import handle_content_stream
from tests.conftest import CapturingChannel, extract_channel_events, extract_event_names


def _user_message(content: str) -> ChatMessage:
    return ChatMessage(id="user-1", role="user", content=content)


class FakeAgentHandle:
    def __init__(
        self,
        initial_events: list[RuntimeEventT],
        continued_events: list[RuntimeEventT] | None = None,
    ) -> None:
        self._initial_events = initial_events
        self._continued_events = continued_events or []
        self.run_calls: list[dict[str, Any]] = []
        self.continue_calls: list[ApprovalResponse] = []
        self.cancel_calls: list[str | None] = []

    async def run(
        self,
        messages: list[Any],
        *,
        add_history_to_context: bool = True,
    ) -> AsyncIterator[RuntimeEventT]:
        self.run_calls.append(
            {
                "messages": messages,
                "add_history_to_context": add_history_to_context,
            }
        )
        for event in self._initial_events:
            yield event

    async def continue_run(
        self,
        approval: ApprovalResponse,
    ) -> AsyncIterator[RuntimeEventT]:
        self.continue_calls.append(approval)
        for event in self._continued_events:
            yield event

    def cancel(self, run_id: str | None = None) -> None:
        self.cancel_calls.append(run_id)


class FakeRuntimeAdapter:
    def __init__(self, handle: FakeAgentHandle) -> None:
        self.handle = handle
        self.create_agent_calls: list[dict[str, Any]] = []

    def create_agent(self, config: Any, **kwargs: Any) -> FakeAgentHandle:
        self.create_agent_calls.append({"config": config, **kwargs})
        return self.handle


@pytest.mark.asyncio
async def test_simple_chat_stream_event_sequence() -> None:
    run_id = "run-simple"
    handle = FakeAgentHandle(
        [
            ContentDelta(run_id=run_id, text="Hello "),
            ContentDelta(run_id=run_id, text="world"),
            RunCompleted(run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    original_adapter = chat_graph_runner_module._RUNTIME_ADAPTER
    chat_graph_runner_module._RUNTIME_ADAPTER = FakeRuntimeAdapter(handle)
    try:
        await handle_content_stream(
            cast(Any, object()),
            [_user_message("say hello")],
            "assistant-1",
            channel,
            chat_id="",
            ephemeral=True,
            convert_message=None,
        )
    finally:
        chat_graph_runner_module._RUNTIME_ADAPTER = original_adapter

    assert extract_event_names(channel) == ["RunContent", "RunContent", "RunCompleted"]


@pytest.mark.asyncio
async def test_tool_call_lifecycle_event_sequence() -> None:
    run_id = "run-tools"
    handle = FakeAgentHandle(
        [
            ContentDelta(run_id=run_id, text="Checking docs..."),
            ToolCallStarted(
                run_id=run_id,
                tool=RuntimeToolCall(
                    id="tool-1",
                    name="search_docs",
                    arguments={"query": "covalt"},
                ),
            ),
            ToolCallCompleted(
                run_id=run_id,
                tool=RuntimeToolResult(
                    id="tool-1",
                    name="search_docs",
                    result='{"hits": 3}',
                ),
            ),
            RunCompleted(run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    original_adapter = chat_graph_runner_module._RUNTIME_ADAPTER
    chat_graph_runner_module._RUNTIME_ADAPTER = FakeRuntimeAdapter(handle)
    try:
        await handle_content_stream(
            cast(Any, object()),
            [_user_message("find docs")],
            "assistant-2",
            channel,
            chat_id="",
            ephemeral=True,
            convert_message=None,
        )
    finally:
        chat_graph_runner_module._RUNTIME_ADAPTER = original_adapter

    assert extract_event_names(channel) == [
        "RunContent",
        "ToolCallStarted",
        "ToolCallCompleted",
        "RunCompleted",
    ]
    events = extract_channel_events(channel)
    completed = next(evt for evt in events if evt.get("event") == "ToolCallCompleted")
    assert completed.get("tool", {}).get("failed") is not True


@pytest.mark.asyncio
async def test_approval_pause_resume_event_sequence() -> None:
    run_id = "run-approval"
    handle = FakeAgentHandle(
        [
            ApprovalRequired(
                run_id=run_id,
                tools=[
                    PendingApproval(
                        tool_call_id="approval-1",
                        tool_name="dangerous_tool",
                        tool_args={"target": "prod"},
                    )
                ],
            )
        ],
        continued_events=[
            ApprovalResolved(
                run_id=run_id,
                tool_call_id="approval-1",
                tool_name="dangerous_tool",
                approval_status="approved",
                tool_args={"target": "prod"},
            ),
            ToolCallCompleted(
                run_id=run_id,
                tool=RuntimeToolResult(
                    id="approval-1",
                    name="dangerous_tool",
                    result="ok",
                ),
            ),
            ContentDelta(run_id=run_id, text="Completed safely."),
            RunCompleted(run_id=run_id),
        ],
    )
    channel = CapturingChannel()

    original_adapter = chat_graph_runner_module._RUNTIME_ADAPTER
    chat_graph_runner_module._RUNTIME_ADAPTER = FakeRuntimeAdapter(handle)
    try:

        async def _auto_approve() -> None:
            while run_control.get_approval_waiter(run_id) is None:
                await asyncio.sleep(0)
            run_control.set_approval_response(
                run_id,
                approved=True,
                tool_decisions={"approval-1": True},
                edited_args={},
            )

        await asyncio.wait_for(
            asyncio.gather(
                handle_content_stream(
                    cast(Any, object()),
                    [_user_message("run dangerous tool")],
                    "assistant-3",
                    channel,
                    chat_id="",
                    ephemeral=True,
                    convert_message=None,
                ),
                _auto_approve(),
            ),
            timeout=3,
        )
    finally:
        chat_graph_runner_module._RUNTIME_ADAPTER = original_adapter

    assert extract_event_names(channel) == [
        "ToolApprovalRequired",
        "ToolApprovalResolved",
        "ToolCallCompleted",
        "RunContent",
        "RunCompleted",
    ]
    assert len(handle.continue_calls) == 1
    assert handle.continue_calls[0].run_id == run_id
    assert handle.continue_calls[0].decisions == {
        "approval-1": chat_graph_runner_module.ToolDecision(approved=True)
    }


@pytest.mark.asyncio
async def test_member_run_delegation_event_sequence() -> None:
    pytest.skip("Legacy Agno Team delegation event sequence no longer applies under runtime adapter architecture")


@pytest.mark.asyncio
async def test_tool_call_failed_omits_render_plan_and_sets_failed_flag() -> None:
    run_id = "run-tools-failed"
    handle = FakeAgentHandle(
        [
            ToolCallStarted(
                run_id=run_id,
                tool=RuntimeToolCall(
                    id="tool-fail-1",
                    name="toolset_alpha:write_file",
                    arguments={"path": "x.py"},
                ),
            ),
            ToolCallCompleted(
                run_id=run_id,
                tool=RuntimeToolResult(
                    id="tool-fail-1",
                    name="toolset_alpha:write_file",
                    result="Error executing tool",
                    failed=True,
                ),
            ),
            RunCompleted(run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    original_adapter = chat_graph_runner_module._RUNTIME_ADAPTER
    original = chat_graph_runner_module._did_tool_call_fail
    chat_graph_runner_module._RUNTIME_ADAPTER = FakeRuntimeAdapter(handle)
    chat_graph_runner_module._did_tool_call_fail = lambda _name, _id: True
    try:
        await handle_content_stream(
            cast(Any, object()),
            [_user_message("trigger failure")],
            "assistant-fail-1",
            channel,
            chat_id="",
            ephemeral=True,
            convert_message=None,
        )
    finally:
        chat_graph_runner_module._RUNTIME_ADAPTER = original_adapter
        chat_graph_runner_module._did_tool_call_fail = original

    events = extract_channel_events(channel)
    completed = next(evt for evt in events if evt.get("event") == "ToolCallCompleted")
    tool = completed.get("tool", {})

    assert tool.get("failed") is True
    assert tool.get("renderPlan") is None
