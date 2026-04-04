"""Characterization tests for current chat streaming event behavior.

These tests intentionally lock today's `handle_content_stream` event protocol
before runtime unification refactors. They should fail if event ordering or
payload wiring changes unexpectedly.
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

import pytest
from agno.agent import RunEvent
from agno.models.response import ToolExecution
from agno.run.agent import BaseAgentRunEvent
from agno.run.team import BaseTeamRunEvent, TeamRunEvent

import backend.services.chat_graph_runner as chat_graph_runner_module
from backend.models.chat import ChatMessage
from backend.services import run_control
from backend.services.chat_graph_runner import handle_content_stream
from tests.conftest import CapturingChannel, extract_channel_events, extract_event_names


def _user_message(content: str) -> ChatMessage:
    return ChatMessage(id="user-1", role="user", content=content)


def _agent_event(
    event: RunEvent,
    *,
    run_id: str,
    content: Any = None,
    agent_name: str = "Assistant",
    reasoning_content: str = "",
    tool: ToolExecution | None = None,
) -> BaseAgentRunEvent:
    chunk = BaseAgentRunEvent(
        event=event,
        run_id=run_id,
        agent_name=agent_name,
        content=content,
    )
    setattr(chunk, "reasoning_content", reasoning_content)
    if tool is not None:
        setattr(chunk, "tool", tool)
    return chunk


def _team_event(
    event: TeamRunEvent,
    *,
    run_id: str,
    content: Any = None,
    team_name: str = "Team",
    tool: ToolExecution | None = None,
) -> BaseTeamRunEvent:
    chunk = BaseTeamRunEvent(
        event=event,
        run_id=run_id,
        team_name=team_name,
        content=content,
    )
    if tool is not None:
        setattr(chunk, "tool", tool)
    return chunk


class FakeAgent:
    def __init__(
        self,
        initial_chunks: list[Any],
        continued_chunks: list[Any] | None = None,
    ) -> None:
        self._initial_chunks = initial_chunks
        self._continued_chunks = continued_chunks or []
        self.arun_calls: list[dict[str, Any]] = []
        self.continue_calls: list[dict[str, Any]] = []
        self.cancel_calls: list[str] = []

    def arun(self, **kwargs: Any):
        self.arun_calls.append(kwargs)

        async def _gen():
            for chunk in self._initial_chunks:
                yield chunk

        return _gen()

    def acontinue_run(self, **kwargs: Any):
        self.continue_calls.append(kwargs)

        async def _gen():
            for chunk in self._continued_chunks:
                yield chunk

        return _gen()

    def cancel_run(self, run_id: str) -> None:
        self.cancel_calls.append(run_id)


@pytest.mark.asyncio
async def test_simple_chat_stream_event_sequence() -> None:
    run_id = "run-simple"
    agent = FakeAgent(
        [
            _agent_event(RunEvent.run_content, run_id=run_id, content="Hello "),
            _agent_event(RunEvent.run_content, run_id=run_id, content="world"),
            _agent_event(RunEvent.run_completed, run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    await handle_content_stream(
        cast(Any, agent),
        [_user_message("say hello")],
        "assistant-1",
        channel,
        chat_id="",
        ephemeral=True,
        convert_message=None,
    )

    assert extract_event_names(channel) == ["RunContent", "RunContent", "RunCompleted"]


@pytest.mark.asyncio
async def test_tool_call_lifecycle_event_sequence() -> None:
    run_id = "run-tools"
    tool_started = ToolExecution(
        tool_call_id="tool-1",
        tool_name="search_docs",
        tool_args={"query": "covalt"},
    )
    tool_completed = ToolExecution(
        tool_call_id="tool-1",
        tool_name="search_docs",
        tool_args={"query": "covalt"},
        result='{"hits": 3}',
    )

    agent = FakeAgent(
        [
            _agent_event(
                RunEvent.run_content, run_id=run_id, content="Checking docs..."
            ),
            _agent_event(
                RunEvent.tool_call_started,
                run_id=run_id,
                tool=tool_started,
            ),
            _agent_event(
                RunEvent.tool_call_completed,
                run_id=run_id,
                tool=tool_completed,
            ),
            _agent_event(RunEvent.run_completed, run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    await handle_content_stream(
        cast(Any, agent),
        [_user_message("find docs")],
        "assistant-2",
        channel,
        chat_id="",
        ephemeral=True,
        convert_message=None,
    )

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
    approval_tool = ToolExecution(
        tool_call_id="approval-1",
        tool_name="dangerous_tool",
        tool_args={"target": "prod"},
        requires_confirmation=True,
    )

    paused = _agent_event(RunEvent.run_paused, run_id=run_id)
    setattr(paused, "tools", [approval_tool])

    continued_tool = ToolExecution(
        tool_call_id="approval-1",
        tool_name="dangerous_tool",
        tool_args={"target": "prod"},
        result="ok",
    )

    agent = FakeAgent(
        [paused],
        continued_chunks=[
            _agent_event(
                RunEvent.tool_call_completed,
                run_id=run_id,
                tool=continued_tool,
            ),
            _agent_event(
                RunEvent.run_content, run_id=run_id, content="Completed safely."
            ),
            _agent_event(RunEvent.run_completed, run_id=run_id),
        ],
    )
    channel = CapturingChannel()

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
                cast(Any, agent),
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

    assert extract_event_names(channel) == [
        "ToolApprovalRequired",
        "ToolApprovalResolved",
        "ToolCallCompleted",
        "RunContent",
        "RunCompleted",
    ]
    assert len(agent.continue_calls) == 1
    assert agent.continue_calls[0]["run_id"] == run_id


@pytest.mark.asyncio
async def test_member_run_delegation_event_sequence() -> None:
    pytest.skip("Legacy Agno Team delegation event sequence no longer applies under runtime adapter architecture")


@pytest.mark.asyncio
async def test_tool_call_failed_omits_render_plan_and_sets_failed_flag() -> None:
    run_id = "run-tools-failed"
    tool_started = ToolExecution(
        tool_call_id="tool-fail-1",
        tool_name="toolset_alpha:write_file",
        tool_args={"path": "x.py"},
    )
    tool_completed = ToolExecution(
        tool_call_id="tool-fail-1",
        tool_name="toolset_alpha:write_file",
        tool_args={"path": "x.py"},
        result="Error executing tool: write_file() missing 2 required positional arguments: 'path' and 'content'",
    )

    agent = FakeAgent(
        [
            _agent_event(
                RunEvent.tool_call_started,
                run_id=run_id,
                tool=tool_started,
            ),
            _agent_event(
                RunEvent.tool_call_completed,
                run_id=run_id,
                tool=tool_completed,
            ),
            _agent_event(RunEvent.run_completed, run_id=run_id),
        ]
    )
    channel = CapturingChannel()

    original = chat_graph_runner_module._did_tool_call_fail
    chat_graph_runner_module._did_tool_call_fail = lambda _name, _id: True
    try:
        await handle_content_stream(
            cast(Any, agent),
            [_user_message("trigger failure")],
            "assistant-fail-1",
            channel,
            chat_id="",
            ephemeral=True,
            convert_message=None,
        )
    finally:
        chat_graph_runner_module._did_tool_call_fail = original

    events = extract_channel_events(channel)
    completed = next(evt for evt in events if evt.get("event") == "ToolCallCompleted")
    tool = completed.get("tool", {})

    assert tool.get("failed") is True
    assert tool.get("renderPlan") is None
