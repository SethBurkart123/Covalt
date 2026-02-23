from __future__ import annotations

import json
from typing import Any

import pytest
from agno.models.message import Message as AgnoMessage

from backend import db
from backend.commands import chats as chats_commands
from backend.models.chat import ChatMessage, ContentBlock
from backend.services import run_control
from backend.services.chat_graph_runner import (
    handle_flow_stream,
    parse_message_blocks,
    run_graph_chat_runtime,
)
import backend.services.chat_graph_runner as chat_graph_runner
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
        captured["message_roles"] = [
            str(message.get("role", "")) for message in chat_input.messages
        ]
        captured["agno_message_roles"] = [
            str(getattr(message, "role", ""))
            for message in getattr(chat_input, "agno_messages", [])
        ]
        captured["entry_scope"] = list(context.services.execution.entry_node_ids)
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
    assert captured["message_roles"] == ["user", "assistant", "user"]
    assert captured["agno_message_roles"] == ["user", "assistant", "user"]
    assert captured["entry_scope"] == ["cs"]


@pytest.mark.asyncio
async def test_handle_flow_stream_exposes_agno_messages_in_chat_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sentinel = [AgnoMessage(role="user", content="hello from agno")]
    captured: dict[str, Any] = {}

    monkeypatch.setattr(
        chat_graph_runner,
        "build_agno_messages_for_chat",
        lambda _messages, _chat_id: sentinel,
    )

    async def fake_run_flow(_graph_data: dict[str, Any], context: Any):
        chat_input = context.services.chat_input
        captured["agno_messages"] = chat_input.agno_messages
        captured["messages"] = chat_input.messages
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ok"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    assert captured["agno_messages"] is sentinel
    assert isinstance(captured["messages"], list)


@pytest.mark.asyncio
async def test_handle_flow_stream_sets_entry_node_ids() -> None:
    graph = make_graph(
        nodes=[
            {
                "id": "cs",
                "type": "chat-start",
                "data": {"includeUserTools": False},
            },
            {"id": "fmt", "type": "llm-completion", "data": {}},
            {"id": "agent_a", "type": "agent", "data": {}},
            {"id": "agent_b", "type": "agent", "data": {}},
        ],
        edges=[
            make_edge("cs", "fmt", "output", "input"),
            make_edge("fmt", "agent_a", "output", "input"),
            make_edge("agent_a", "agent_b", "output", "input"),
        ],
    )

    captured: dict[str, Any] = {}

    async def fake_run_flow(_graph_data: dict[str, Any], context: Any):
        captured["entry_node_ids"] = list(context.services.execution.entry_node_ids)
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ok"})}
        )

    await handle_flow_stream(
        graph,
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    assert captured["entry_node_ids"] == ["cs"]


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


@pytest.mark.asyncio
async def test_handle_flow_stream_persists_ordered_execution_events() -> None:
    assistant_id = "assistant-trace-1"

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="started",
            run_id="runtime-1",
            data={},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="progress",
            run_id="runtime-1",
            data={"token": "hello "},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="runtime-1",
            data={"event": "CustomGraphEvent", "payload": {"x": 1}},
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="completed",
            run_id="runtime-1",
            data={},
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "done"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        assistant_id,
        CapturingChannel(),
        chat_id="chat-trace-1",
        ephemeral=False,
        run_flow_impl=fake_run_flow,
        save_content_impl=lambda _msg_id, _content: None,
        load_initial_content_impl=lambda _msg_id: [],
    )

    with db.db_session() as sess:
        run = db.get_latest_execution_run_for_message(sess, message_id=assistant_id)
        assert run is not None
        assert run.kind == "workflow"
        assert run.status == "completed"

        events = db.get_execution_events(sess, execution_id=run.id)

    assert [event["seq"] for event in events] == [1, 2, 3, 4, 5]
    assert [event["eventType"] for event in events] == [
        "runtime.node.started",
        "runtime.node.progress",
        "runtime.node.agent_event",
        "runtime.node.completed",
        "runtime.execution_result",
    ]
    assert events[2]["payload"] == {"event": "CustomGraphEvent", "payload": {"x": 1}}


@pytest.mark.asyncio
async def test_get_message_execution_trace_returns_latest_run_events() -> None:
    assistant_id = "assistant-trace-api-1"

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="started",
            run_id="runtime-2",
            data={},
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ok"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        assistant_id,
        CapturingChannel(),
        chat_id="chat-trace-api-1",
        ephemeral=False,
        run_flow_impl=fake_run_flow,
        save_content_impl=lambda _msg_id, _content: None,
        load_initial_content_impl=lambda _msg_id: [],
    )

    trace = await chats_commands.get_message_execution_trace(
        chats_commands.MessageId(id=assistant_id)
    )

    assert trace.executionId
    assert trace.kind == "workflow"
    assert trace.status == "completed"
    assert [event.eventType for event in trace.events] == [
        "runtime.node.started",
        "runtime.execution_result",
    ]


@pytest.mark.asyncio
async def test_handle_flow_stream_persists_member_run_blocks_in_saved_content() -> None:
    saved_payloads: list[str] = []

    def fake_save_content(_message_id: str, content: str) -> None:
        saved_payloads.append(content)

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "MemberRunStarted",
                "memberRunId": "member-1",
                "memberName": "Joe",
            },
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "RunContent",
                "memberRunId": "member-1",
                "memberName": "Joe",
                "content": "hello from member",
            },
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "ToolCallStarted",
                "memberRunId": "member-1",
                "memberName": "Joe",
                "tool": {
                    "id": "tool-1",
                    "toolName": "search_docs",
                    "toolArgs": {"query": "cats"},
                },
            },
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "ToolCallCompleted",
                "memberRunId": "member-1",
                "memberName": "Joe",
                "tool": {
                    "id": "tool-1",
                    "toolName": "search_docs",
                    "toolResult": "ok",
                },
            },
        )
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="agent_event",
            run_id="run-1",
            data={
                "event": "MemberRunCompleted",
                "memberRunId": "member-1",
                "memberName": "Joe",
            },
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "done"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        ephemeral=False,
        run_flow_impl=fake_run_flow,
        save_content_impl=fake_save_content,
        load_initial_content_impl=lambda _message_id: [],
    )

    assert saved_payloads
    final_blocks = json.loads(saved_payloads[-1])
    member_block = next(
        block for block in final_blocks if block.get("type") == "member_run"
    )
    assert member_block["runId"] == "member-1"
    assert member_block["isCompleted"] is True
    assert any(
        block.get("type") == "text" and block.get("content") == "hello from member"
        for block in member_block["content"]
    )
    assert any(
        block.get("type") == "tool_call"
        and block.get("id") == "tool-1"
        and block.get("isCompleted") is True
        for block in member_block["content"]
    )


@pytest.mark.asyncio
async def test_handle_flow_stream_splits_text_blocks_between_nodes() -> None:
    saved_payloads: list[str] = []

    def fake_save_content(_message_id: str, content: str) -> None:
        saved_payloads.append(content)

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent-1",
            node_type="agent",
            event_type="started",
            run_id="run-1",
        )
        yield NodeEvent(
            node_id="agent-1",
            node_type="agent",
            event_type="progress",
            run_id="run-1",
            data={"token": "first"},
        )
        yield NodeEvent(
            node_id="agent-1",
            node_type="agent",
            event_type="completed",
            run_id="run-1",
        )
        yield NodeEvent(
            node_id="agent-2",
            node_type="agent",
            event_type="started",
            run_id="run-1",
        )
        yield NodeEvent(
            node_id="agent-2",
            node_type="agent",
            event_type="progress",
            run_id="run-1",
            data={"token": "second"},
        )
        yield NodeEvent(
            node_id="agent-2",
            node_type="agent",
            event_type="completed",
            run_id="run-1",
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "done"})}
        )

    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        ephemeral=False,
        run_flow_impl=fake_run_flow,
        save_content_impl=fake_save_content,
        load_initial_content_impl=lambda _message_id: [],
    )

    assert saved_payloads
    final_blocks = json.loads(saved_payloads[-1])
    text_blocks = [block.get("content") for block in final_blocks if block.get("type") == "text"]
    assert text_blocks == ["first", "second"]
