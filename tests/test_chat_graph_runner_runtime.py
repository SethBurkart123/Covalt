from __future__ import annotations

import json
from typing import Any

import pytest

from backend import db
from backend.models import parse_message_blocks
from backend.models.chat import Attachment, ChatMessage, ContentBlock
from backend.services.streaming import run_control
from backend.services.streaming.chat_stream import handle_flow_stream, run_graph_chat_runtime
from backend.services.tools.tool_render import _build_tool_call_completed_payload
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


def test_build_tool_call_completed_payload_marks_unresolved_render_refs_as_failed() -> None:
    payload = _build_tool_call_completed_payload(
        tool_id="tool-1",
        tool_name="file-tools:write_file",
        tool_args={"path": "src/login.html"},
        tool_result="Error executing tool: write_file() got an unexpected keyword argument 'text'",
        render_plan={"renderer": "code", "config": {"file": "$args.path"}},
        failed=False,
    )

    assert payload.get("failed") is True
    assert payload.get("renderPlan") is None


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
                    "toolArgs": {"query": "covalt"},
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
async def test_handle_flow_stream_cancelled_runtime_does_not_emit_fallback_run_content() -> None:
    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield NodeEvent(
            node_id="agent",
            node_type="agent",
            event_type="cancelled",
            run_id="run-1",
            data={},
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "user text echo"})}
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
    assert "RunContent" not in event_names


@pytest.mark.asyncio
async def test_handle_flow_stream_cancel_requested_without_cancelled_event_does_not_inject_user_text() -> None:
    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        active = run_control.get_active_run("assistant-1")
        assert active is not None
        _, cancel_handle = active
        cancel_handle.request_cancel()
        yield ExecutionResult(
            outputs={
                "output": DataValue(
                    type="data",
                    value={"message": "can you try searching agno?"},
                )
            }
        )

    channel = CapturingChannel()
    await handle_flow_stream(
        _graph(),
        None,
        [ChatMessage(id="user-1", role="user", content="can you try searching agno?")],
        "assistant-1",
        channel,
        ephemeral=True,
        run_flow_impl=fake_run_flow,
    )

    event_names = [event.get("event") for event in channel.events]
    assert "RunCancelled" in event_names
    run_content_events = [event for event in channel.events if event.get("event") == "RunContent"]
    assert run_content_events == []


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
        captured["runtime_messages_len"] = len(chat_input.runtime_messages)
        captured["last_user_message"] = chat_input.last_user_message
        captured["message_roles"] = [
            str(message.role) for message in chat_input.runtime_messages
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
    assert captured["runtime_messages_len"] == 3
    assert captured["last_user_message"] == "final"
    assert captured["message_roles"] == ["user", "assistant", "user"]
    assert captured["entry_scope"] == ["cs"]


@pytest.mark.asyncio
async def test_handle_flow_stream_exposes_runtime_messages_in_chat_input() -> None:
    captured: dict[str, Any] = {}

    async def fake_run_flow(_graph_data: dict[str, Any], context: Any):
        chat_input = context.services.chat_input
        captured["runtime_messages"] = chat_input.runtime_messages
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

    assert isinstance(captured["runtime_messages"], list)
    assert len(captured["runtime_messages"]) == 1
    assert captured["runtime_messages"][0].role == "user"


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


@pytest.mark.asyncio
async def test_handle_flow_stream_applies_chat_start_runtime_config_and_records_chat_start_output() -> (
    None
):
    graph = make_graph(
        nodes=[
            {
                "id": "chat-entry",
                "type": "chat-start",
                "data": {
                    "primaryAgentId": "agent-primary",
                    "includeUserTools": True,
                },
            },
            {
                "id": "agent-primary",
                "type": "agent",
                "data": {},
            },
        ],
        edges=[make_edge("chat-entry", "agent-primary", "output", "input")],
    )

    channel = CapturingChannel()
    captured: dict[str, Any] = {}

    async def fake_run_flow(_graph_data: dict[str, Any], context: Any):
        chat_output = context.services.chat_output
        captured["primary_agent_id"] = getattr(chat_output, "primary_agent_id", None)
        captured["primary_agent_source"] = getattr(chat_output, "primary_agent_source", None)

        output_payload = {
            "message": context.services.chat_input.last_user_message,
            "last_user_message": context.services.chat_input.last_user_message,
            "runtime_messages": context.services.chat_input.runtime_messages,
            "attachments": context.services.chat_input.last_user_attachments,
            "include_user_tools": True,
        }
        output_value = DataValue(type="data", value=output_payload)

        yield NodeEvent(
            node_id="chat-entry",
            node_type="chat-start",
            event_type="started",
            run_id="run-chat-start",
        )
        yield NodeEvent(
            node_id="chat-entry",
            node_type="chat-start",
            event_type="result",
            run_id="run-chat-start",
            data={
                "outputs": {
                    "output": {
                        "type": output_value.type,
                        "value": output_value.value,
                    }
                }
            },
        )
        yield NodeEvent(
            node_id="chat-entry",
            node_type="chat-start",
            event_type="completed",
            run_id="run-chat-start",
        )
        yield ExecutionResult(outputs={"output": output_value})

    user_message = ChatMessage(
        id="user-1",
        role="user",
        content="hello graph",
        attachments=[
            Attachment(
                id="att-1",
                type="file",
                name="notes.txt",
                mimeType="text/plain",
                size=3,
            )
        ],
    )

    await handle_flow_stream(
        graph,
        None,
        [user_message],
        "assistant-chat-start",
        channel,
        chat_id="chat-start-runtime",
        ephemeral=False,
        run_flow_impl=fake_run_flow,
        save_content_impl=lambda _message_id, _content: None,
        load_initial_content_impl=lambda _message_id: [],
    )

    assert captured["primary_agent_id"] == "agent-primary"
    assert captured["primary_agent_source"] == "chat-entry"

    run_completed_events = [
        event for event in channel.events if event.get("event") == "RunCompleted"
    ]
    assert run_completed_events, "expected RunCompleted event to be emitted"

    with db.db_session() as sess:
        run = db.get_latest_execution_run_for_message(
            sess, message_id="assistant-chat-start"
        )
        assert run is not None
        events = db.get_execution_events(sess, execution_id=run.id)

    runtime_result = next(
        event for event in events if event["eventType"] == "runtime.execution_result"
    )
    output_value = runtime_result["payload"]["outputs"]["output"]["value"]

    assert output_value["message"] == "hello graph"
    assert output_value["last_user_message"] == "hello graph"
    assert "RuntimeMessage(role='user', content='hello graph'" in output_value["runtime_messages"][0]
    assert output_value["attachments"][0]["id"] == "att-1"
    assert output_value["attachments"][0]["mimeType"] == "text/plain"
    assert output_value["include_user_tools"] is True


@pytest.mark.asyncio
async def test_handle_flow_stream_executes_chat_start_through_plugin_registry() -> None:
    graph = make_graph(
        nodes=[
            {
                "id": "chat-entry",
                "type": "chat-start",
                "data": {"includeUserTools": True},
            }
        ],
        edges=[],
    )

    channel = CapturingChannel()
    user_message = ChatMessage(
        id="user-integration-1",
        role="user",
        content="integration hello",
        attachments=[
            Attachment(
                id="att-integration-1",
                type="file",
                name="integration.txt",
                mimeType="text/plain",
                size=11,
            )
        ],
    )

    await handle_flow_stream(
        graph,
        None,
        [user_message],
        "assistant-chat-start-integration",
        channel,
        chat_id="chat-start-integration",
        ephemeral=False,
        save_content_impl=lambda _message_id, _content: None,
        load_initial_content_impl=lambda _message_id: [],
    )

    flow_result_events = [
        event for event in channel.events if event.get("event") == "FlowNodeResult"
    ]
    assert flow_result_events, "expected FlowNodeResult from chat-start execution"

    with db.db_session() as sess:
        run = db.get_latest_execution_run_for_message(
            sess, message_id="assistant-chat-start-integration"
        )
        assert run is not None
        events = db.get_execution_events(sess, execution_id=run.id)

    runtime_result = next(
        event for event in events if event["eventType"] == "runtime.execution_result"
    )
    output_value = runtime_result["payload"]["outputs"]["output"]["value"]

    assert output_value["message"] == "integration hello"
    assert output_value["last_user_message"] == "integration hello"
    assert "RuntimeMessage(role='user', content='integration hello'" in output_value["runtime_messages"][0]
    assert output_value["attachments"][0]["id"] == "att-integration-1"
    assert output_value["attachments"][0]["mimeType"] == "text/plain"
    assert output_value["include_user_tools"] is True

@pytest.mark.asyncio
async def test_handle_flow_stream_preserves_trailing_error_block_from_initial_content() -> None:
    saved_payloads: list[str] = []

    def fake_save_content(_message_id: str, content: str) -> None:
        saved_payloads.append(content)

    async def fake_run_flow(*_args: Any, **_kwargs: Any):
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ok"})}
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
        load_initial_content_impl=lambda _message_id: [
            {"type": "text", "content": "kept"},
            {"type": "error", "content": "stale"},
        ],
    )

    assert saved_payloads
    final_blocks = json.loads(saved_payloads[-1])
    assert final_blocks == [
        {"type": "text", "content": "kept"},
        {"type": "error", "content": "stale"},
    ]


@pytest.mark.asyncio
async def test_handle_flow_stream_keeps_existing_tool_call_and_updates_completion_payload() -> (
    None
):
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
                "event": "ToolCallCompleted",
                "tool": {
                    "id": "tool-1",
                    "toolName": "search_docs",
                    "toolArgs": {"query": "cats"},
                    "toolResult": "done",
                    "providerData": {"provider": "openai"},
                },
            },
        )
        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"response": "ignored"})}
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
        load_initial_content_impl=lambda _message_id: [
            {
                "type": "tool_call",
                "id": "tool-1",
                "toolName": "search_docs",
                "toolArgs": {"query": "cats"},
                "isCompleted": False,
            }
        ],
    )

    assert saved_payloads
    final_blocks = json.loads(saved_payloads[-1])
    assert len(final_blocks) == 2

    tool_block = final_blocks[0]
    assert tool_block["type"] == "tool_call"
    assert tool_block["id"] == "tool-1"
    assert tool_block["toolName"] == "search_docs"
    assert tool_block["toolArgs"] == {"query": "cats"}
    assert tool_block["toolResult"] == "done"
    assert tool_block["isCompleted"] is True
    assert tool_block["providerData"] == {"provider": "openai"}

    assert final_blocks[1] == {"type": "text", "content": "ignored"}
