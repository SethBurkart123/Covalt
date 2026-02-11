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

from backend.commands import streaming
from backend.models.chat import ChatMessage
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


@pytest.fixture(autouse=True)
def _reset_streaming_state():
    streaming._active_runs.clear()
    streaming._cancelled_messages.clear()
    streaming._approval_events.clear()
    streaming._approval_responses.clear()
    yield
    streaming._active_runs.clear()
    streaming._cancelled_messages.clear()
    streaming._approval_events.clear()
    streaming._approval_responses.clear()


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

    await streaming.handle_content_stream(
        cast(Any, agent),
        [_user_message("say hello")],
        "assistant-1",
        channel,
        chat_id="",
        ephemeral=True,
    )

    assert extract_event_names(channel) == ["RunContent", "RunContent", "RunCompleted"]


@pytest.mark.asyncio
async def test_tool_call_lifecycle_event_sequence() -> None:
    run_id = "run-tools"
    tool_started = ToolExecution(
        tool_call_id="tool-1",
        tool_name="search_docs",
        tool_args={"query": "agno"},
    )
    tool_completed = ToolExecution(
        tool_call_id="tool-1",
        tool_name="search_docs",
        tool_args={"query": "agno"},
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

    await streaming.handle_content_stream(
        cast(Any, agent),
        [_user_message("find docs")],
        "assistant-2",
        channel,
        chat_id="",
        ephemeral=True,
    )

    assert extract_event_names(channel) == [
        "RunContent",
        "ToolCallStarted",
        "ToolCallCompleted",
        "RunCompleted",
    ]


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
        while run_id not in streaming._approval_events:
            await asyncio.sleep(0)
        streaming._approval_responses[run_id] = {
            "approved": True,
            "tool_decisions": {"approval-1": True},
            "edited_args": {},
        }
        streaming._approval_events[run_id].set()

    await asyncio.wait_for(
        asyncio.gather(
            streaming.handle_content_stream(
                cast(Any, agent),
                [_user_message("run dangerous tool")],
                "assistant-3",
                channel,
                chat_id="",
                ephemeral=True,
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
    team_run_id = "team-run-1"
    member_run_id = "member-run-1"

    delegation_start = _team_event(
        TeamRunEvent.tool_call_started,
        run_id=team_run_id,
        tool=ToolExecution(
            tool_call_id="delegate-1",
            tool_name="delegate_task_to_member",
            tool_args={"task": "Research AGENTS.md"},
        ),
    )
    member_content = _agent_event(
        RunEvent.run_content,
        run_id=member_run_id,
        agent_name="Researcher",
        content="Found key details.",
    )
    member_reasoning = _agent_event(
        RunEvent.reasoning_step,
        run_id=member_run_id,
        agent_name="Researcher",
        reasoning_content="Comparing options...",
    )
    delegation_complete = _team_event(
        TeamRunEvent.tool_call_completed,
        run_id=team_run_id,
        tool=ToolExecution(
            tool_call_id="delegate-1",
            tool_name="delegate_task_to_member",
            tool_args={"task": "Research AGENTS.md"},
            result="done",
        ),
    )
    run_complete = _team_event(TeamRunEvent.run_completed, run_id=team_run_id)

    agent = FakeAgent(
        [
            delegation_start,
            member_content,
            member_reasoning,
            delegation_complete,
            run_complete,
        ]
    )
    channel = CapturingChannel()

    await streaming.handle_content_stream(
        cast(Any, agent),
        [_user_message("delegate this")],
        "assistant-4",
        channel,
        chat_id="",
        ephemeral=True,
    )

    assert extract_event_names(channel) == [
        "MemberRunStarted",
        "RunContent",
        "ReasoningStep",
        "MemberRunCompleted",
        "RunCompleted",
    ]

    events = extract_channel_events(channel)
    member_events = [evt for evt in events if evt.get("memberRunId") == member_run_id]
    assert len(member_events) >= 3
