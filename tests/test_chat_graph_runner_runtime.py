from __future__ import annotations

from typing import Any

import pytest

from backend.models.chat import ChatMessage, ContentBlock
from backend.services import run_control
from backend.services.chat_graph_runner import (
    handle_flow_stream,
    parse_message_blocks,
    run_graph_chat_runtime,
)
from nodes._types import DataValue, ExecutionResult, NodeEvent
from tests.conftest import CapturingChannel, make_edge, make_graph, make_node


def _graph() -> dict[str, Any]:
    return make_graph(
        nodes=[
            make_node("cs", "chat-start"),
            make_node("agent", "agent"),
        ],
        edges=[make_edge("cs", "agent", "output", "input")],
    )


@pytest.fixture(autouse=True)
def _reset_run_control_state():
    run_control.reset_state()
    yield
    run_control.reset_state()


@pytest.mark.asyncio
async def test_runtime_delegates_to_flow_handler_without_prebuilt_agent() -> None:
    captured: dict[str, Any] = {}

    async def fake_flow_handler(
        graph_data: dict[str, Any],
        agent: Any,
        messages: list[ChatMessage],
        assistant_msg_id: str,
        channel: Any,
        **kwargs: Any,
    ) -> None:
        captured["graph_data"] = graph_data
        captured["agent"] = agent
        captured["messages"] = messages
        captured["assistant_msg_id"] = assistant_msg_id
        captured["chat_id"] = kwargs.get("chat_id")
        captured["ephemeral"] = kwargs.get("ephemeral")
        captured["extra_tool_ids"] = kwargs.get("extra_tool_ids")

    await run_graph_chat_runtime(
        _graph(),
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        chat_id="chat-1",
        ephemeral=True,
        extra_tool_ids=["tool:custom"],
        flow_stream_handler=fake_flow_handler,
    )

    assert captured["graph_data"]["nodes"][0]["id"] == "cs"
    assert captured["agent"] is None
    assert captured["assistant_msg_id"] == "assistant-1"
    assert captured["chat_id"] == "chat-1"
    assert captured["ephemeral"] is True
    assert captured["extra_tool_ids"] == ["tool:custom"]


@pytest.mark.asyncio
async def test_runtime_requires_user_message() -> None:
    async def fake_flow_handler(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("handler should not be called")

    with pytest.raises(ValueError, match="No user message found"):
        await run_graph_chat_runtime(
            _graph(),
            [],
            "assistant-1",
            CapturingChannel(),
            chat_id="chat-1",
            ephemeral=False,
            flow_stream_handler=fake_flow_handler,
        )


def test_parse_message_blocks_normalizes_non_dict_entries() -> None:
    blocks = parse_message_blocks('[{"type":"text","content":"ok"}, 123]')
    assert blocks == [
        {"type": "text", "content": "ok"},
        {"type": "text", "content": "123"},
    ]


def test_parse_message_blocks_strips_trailing_errors() -> None:
    blocks = parse_message_blocks(
        '[{"type":"text","content":"ok"},{"type":"error","content":"x"}]',
        strip_trailing_errors=True,
    )
    assert blocks == [{"type": "text", "content": "ok"}]


@pytest.mark.asyncio
async def test_handle_flow_stream_forwards_agent_runtime_events() -> None:
    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={"event": "ReasoningStep", "reasoningContent": "thinking"},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "ToolCallStarted",
                "tool": {
                    "id": "tool-1",
                    "toolName": "search_docs",
                    "toolArgs": {"query": "agno"},
                    "isCompleted": False,
                },
            },
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "done"})}
        )

    channel = CapturingChannel()
    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        channel,
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    events = [event.get("event") for event in channel.events]
    assert "ReasoningStep" in events
    assert "ToolCallStarted" in events
    assert "RunCompleted" in events


@pytest.mark.asyncio
async def test_handle_flow_stream_emits_cancelled_when_runtime_cancels() -> None:
    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_run_id",
            run_id="run-1",
            data={"run_id": "run-flow-1"},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="cancelled",
            run_id="run-1",
            data={},
        )

    channel = CapturingChannel()
    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        channel,
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    event_names = [event.get("event") for event in channel.events]
    assert "RunCancelled" in event_names
    assert run_control.get_active_run("assistant-1") is None


@pytest.mark.asyncio
async def test_handle_flow_stream_error_is_terminal_and_no_content_after_error() -> (
    None
):
    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="progress",
            run_id="run-1",
            data={"token": "hello "},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="error",
            run_id="run-1",
            data={"error": "boom"},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="progress",
            run_id="run-1",
            data={"token": "late "},
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "late"})}
        )

    channel = CapturingChannel()
    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        channel,
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    event_names = [event.get("event") for event in channel.events]
    assert event_names.count("RunError") == 1
    assert "RunCompleted" not in event_names

    error_index = event_names.index("RunError")
    assert "RunContent" not in event_names[error_index + 1 :]


@pytest.mark.asyncio
async def test_handle_flow_stream_passes_extra_tool_ids_into_runtime_context() -> None:
    captured: dict[str, Any] = {}

    async def fake_run_flow(_graph_data: dict[str, Any], context: Any):
        captured["extra_tool_ids"] = context.services.extra_tool_ids
        chat_input = context.services.chat_input
        captured["history_len"] = len(chat_input.history)
        captured["last_user_message"] = chat_input.last_user_message
        captured["agno_roles"] = [
            str(getattr(message, "role", "")) for message in chat_input.agno_messages
        ]
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ok"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [
            ChatMessage(id="user-1", role="user", content="hello"),
            ChatMessage(
                id="assistant-0",
                role="assistant",
                content=[ContentBlock(type="text", content="hi")],
            ),
            ChatMessage(id="user-2", role="user", content="final"),
        ],
        "assistant-1",
        CapturingChannel(),
        ephemeral=True,
        extra_tool_ids=["mcp:github"],
        run_flow_impl=fake_run_flow,
    )

    assert captured["extra_tool_ids"] == ["mcp:github"]
    assert captured["history_len"] == 3
    assert captured["last_user_message"] == "final"
    assert captured["agno_roles"] == ["user", "assistant", "user"]


@pytest.mark.asyncio
async def test_handle_flow_stream_honors_early_cancel_marker() -> None:
    called = False

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        nonlocal called
        called = True
        yield ExecutionResult(outputs={"output": DataValue(type="data", value={})})

    run_control.mark_early_cancel("assistant-1")

    channel = CapturingChannel()
    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        channel,
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    assert called is False
    assert [event.get("event") for event in channel.events] == ["RunCancelled"]
