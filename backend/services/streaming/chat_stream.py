from __future__ import annotations

import asyncio
import json
import logging
import traceback
import types
import uuid
from collections.abc import Callable
from typing import Any

from zynk import Channel

from backend.runtime import (
    AgentHandle,
    runtime_messages_from_chat_messages,
)
from nodes._types import DataValue, ExecutionResult, NodeEvent

from ... import db
from ...models.chat import ChatEvent, ChatMessage
from ..chat.chat_graph_config import (
    FlowStreamHandler,
    _apply_runtime_config,
    _build_entry_node_ids,
    _count_agent_nodes,
    _is_delegation_tool,
)
from ..chat.chat_graph_config import (
    _build_trigger_payload as _build_trigger_payload_impl,
)
from ..chat.chat_utils import _require_user_message, extract_error_message
from ..flows.flow_executor import run_flow
from ..flows.flow_migration import migrate_graph_data, requires_graph_migration
from ..tools.mcp_manager import ensure_mcp_initialized
from ..tools.tool_registry import get_tool_registry
from ..tools.tool_render import _ensure_tool_call_completed_payload
from . import run_control
from . import stream_broadcaster as broadcaster
from .content_accumulator import ContentAccumulator
from .execution_trace import ExecutionTraceRecorder
from .runtime_events import (
    EVENT_FLOW_NODE_COMPLETED,
    EVENT_FLOW_NODE_ERROR,
    EVENT_FLOW_NODE_RESULT,
    EVENT_FLOW_NODE_STARTED,
    EVENT_RUN_CANCELLED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
    EVENT_TOOL_APPROVAL_REQUIRED,
    EVENT_TOOL_APPROVAL_RESOLVED,
    EVENT_TOOL_CALL_COMPLETED,
    EVENT_TOOL_CALL_STARTED,
    emit_chat_event,
    make_chat_event,
)
from .stream_lifecycle import (
    BroadcastingChannel,
    load_initial_content,
    save_msg_content,
)

logger = logging.getLogger(__name__)
registry = get_tool_registry()


class FlowRunHandle:
    """Run-control bridge for graph runtime flows."""

    def __init__(self) -> None:
        self._handle: AgentHandle | None = None
        self._run_id: str | None = None
        self._cancel_requested = False

    def _apply_cancel_if_ready(self) -> None:
        if not self._cancel_requested or self._handle is None or not self._run_id:
            return

        try:
            self._handle.cancel(self._run_id)
        except Exception:
            logger.exception("[flow_stream] Failed to cancel bound agent run")

    def bind_agent(self, handle: AgentHandle) -> None:
        self._handle = handle
        self._apply_cancel_if_ready()

    def set_run_id(self, run_id: str) -> None:
        if run_id:
            self._run_id = run_id
        self._apply_cancel_if_ready()

    def request_cancel(self) -> None:
        self._cancel_requested = True
        self._apply_cancel_if_ready()

    def cancel(self, run_id: str | None = None) -> None:
        if run_id:
            self._run_id = run_id
        self.request_cancel()

    def is_cancel_requested(self) -> bool:
        return self._cancel_requested


class ChatFlowCancelHandle:
    def __init__(self, run_handle: FlowRunHandle, execution_ctx: Any | None) -> None:
        self._run_handle = run_handle
        self._execution_ctx = execution_ctx

    def bind_agent(self, handle: AgentHandle) -> None:
        self._run_handle.bind_agent(handle)

    def set_run_id(self, run_id: str) -> None:
        self._run_handle.set_run_id(run_id)

    def request_cancel(self) -> None:
        if self._execution_ctx is not None:
            setattr(self._execution_ctx, "stop_run", True)
        self._run_handle.request_cancel()

    def cancel(self, run_id: str | None = None) -> None:
        if self._execution_ctx is not None:
            setattr(self._execution_ctx, "stop_run", True)
        self._run_handle.cancel(run_id)

    def is_cancel_requested(self) -> bool:
        return self._run_handle.is_cancel_requested()


def _pick_text_output(outputs: dict[str, DataValue]) -> DataValue | None:
    if not outputs:
        return None

    data_output = outputs.get("output") or outputs.get("true") or outputs.get("false")
    if data_output is None:
        for value in outputs.values():
            if value.type == "string":
                return value
        return next(iter(outputs.values()))

    raw_value = data_output.value
    if isinstance(raw_value, dict):
        for key in ("response", "text", "message"):
            if key in raw_value and raw_value.get(key) is not None:
                return DataValue(type="string", value=str(raw_value.get(key)))
        return DataValue(type="string", value=str(raw_value))

    return DataValue(type="string", value="" if raw_value is None else str(raw_value))


def _coerce_event_outputs(outputs: Any) -> dict[str, DataValue]:
    if not isinstance(outputs, dict):
        return {}

    coerced: dict[str, DataValue] = {}
    for handle, payload in outputs.items():
        if not isinstance(payload, dict):
            continue
        value_type = payload.get("type")
        if not isinstance(value_type, str) or not value_type:
            continue
        coerced[str(handle)] = DataValue(type=value_type, value=payload.get("value"))
    return coerced


def _build_trigger_payload(
    user_message: str,
    runtime_messages: list[Any],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    return _build_trigger_payload_impl(
        user_message,
        runtime_messages,
        attachments,
    )


def _chat_event_from_agent_runtime_event(data: dict[str, Any]) -> ChatEvent | None:
    event_name = str(data.get("event") or "")
    if not event_name:
        return None

    payload: dict[str, Any] = {"event": event_name}
    for key in (
        "content",
        "reasoningContent",
        "tool",
        "memberRunId",
        "memberName",
        "task",
        "groupByNode",
        "nodeId",
        "nodeType",
    ):
        if key in data:
            payload[key] = data.get(key)

    return make_chat_event(
        event_name,
        allow_unknown=True,
        **{key: value for key, value in payload.items() if key != "event"},
    )


def _is_delegation_agent_event(data: dict[str, Any]) -> bool:
    event_name = str(data.get("event") or "")
    if event_name not in {EVENT_TOOL_CALL_STARTED, EVENT_TOOL_CALL_COMPLETED}:
        return False
    tool = data.get("tool")
    if not isinstance(tool, dict):
        return False
    return bool(tool.get("isDelegation")) or _is_delegation_tool(str(tool.get("toolName") or ""))



async def _persist_accumulator(
    save_content: Callable[[str, str], None],
    assistant_msg_id: str,
    accumulator: ContentAccumulator,
    *,
    final: bool = False,
) -> None:
    payload = accumulator.dump_final() if final else accumulator.serialize()
    await asyncio.to_thread(save_content, assistant_msg_id, payload)


def _mark_message_complete(assistant_msg_id: str) -> None:
    with db.db_session() as sess:
        db.mark_message_complete(sess, assistant_msg_id)


def _deny_pending_approvals(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mark every pending HITL tool block (recursing into member_runs) as denied."""
    denied: list[dict[str, Any]] = []
    for block in blocks:
        block_type = block.get("type")
        if block_type == "tool_call":
            tool_id = str(block.get("id") or "")
            if (
                tool_id
                and bool(block.get("requiresApproval"))
                and block.get("approvalStatus") == "pending"
            ):
                block["approvalStatus"] = "denied"
                block["isCompleted"] = True
                tool_args = block.get("toolArgs")
                denied.append(
                    {
                        "id": tool_id,
                        "approvalStatus": "denied",
                        "toolArgs": tool_args if isinstance(tool_args, dict) else {},
                    }
                )
        elif block_type == "member_run":
            member_content = block.get("content")
            if isinstance(member_content, list):
                denied.extend(_deny_pending_approvals(member_content))
    return denied


def _fail_inflight_tool_calls(
    blocks: list[dict[str, Any]],
    *,
    message: str = "Cancelled by user",
) -> list[dict[str, Any]]:
    """Mark any still-running, non-approval tool calls (recursing into member_runs)
    as failed with a cancellation result. Returns the affected tool blocks."""
    affected: list[dict[str, Any]] = []
    for block in blocks:
        block_type = block.get("type")
        if block_type == "tool_call":
            if block.get("isCompleted"):
                continue
            if block.get("requiresApproval") and block.get("approvalStatus") == "pending":
                continue
            block["isCompleted"] = True
            block["failed"] = True
            block["toolResult"] = message
            block.pop("renderPlan", None)
            affected.append(block)
        elif block_type == "member_run":
            member_content = block.get("content")
            if isinstance(member_content, list):
                affected.extend(
                    _fail_inflight_tool_calls(member_content, message=message)
                )
    return affected


async def handle_flow_stream(
    graph_data: dict[str, Any],
    agent: Any,
    messages: list[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
    agent_id: str | None = None,
    extra_tool_ids: list[str] | None = None,
    run_flow_impl: Callable[..., Any] | None = None,
    save_content_impl: Callable[[str, str], None] | None = None,
    load_initial_content_impl: Callable[[str], list[dict[str, Any]]] | None = None,
) -> None:
    del agent, agent_id

    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch

    def _noop_save(msg_id: str, content: str) -> None:
        del msg_id, content

    save_content_fn = save_content_impl or save_msg_content
    load_initial_fn = load_initial_content_impl or load_initial_content
    save_content = save_content_fn if not ephemeral else _noop_save

    trace_recorder = ExecutionTraceRecorder(
        kind="workflow",
        chat_id=chat_id or None,
        message_id=assistant_msg_id,
        enabled=not ephemeral,
    )
    trace_recorder.start()
    trace_status = "streaming"
    trace_error: str | None = None

    run_handle = FlowRunHandle()

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    if run_control.consume_early_cancel(assistant_msg_id):
        run_control.remove_active_run(assistant_msg_id)
        run_control.clear_early_cancel(assistant_msg_id)
        trace_recorder.record(event_type="runtime.run.cancelled", payload={"early": True})
        trace_status = "cancelled"
        trace_recorder.finish(status=trace_status)
        emit_chat_event(ch, EVENT_RUN_CANCELLED)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
        return

    user_message = ""
    last_user_attachments: list[dict[str, Any]] = []
    if messages and messages[-1].role == "user":
        last_user_message = messages[-1]
        content = last_user_message.content
        user_message = content if isinstance(content, str) else json.dumps(content)
        for attachment in last_user_message.attachments or []:
            if isinstance(attachment, dict):
                last_user_attachments.append(dict(attachment))
            elif hasattr(attachment, "model_dump"):
                payload = attachment.model_dump()
                if isinstance(payload, dict):
                    last_user_attachments.append(payload)

    runtime_messages = runtime_messages_from_chat_messages(messages, chat_id)
    if requires_graph_migration(graph_data):
        normalized_graph_data = migrate_graph_data(graph_data)
    else:
        normalized_graph_data = graph_data
    entry_node_ids = _build_entry_node_ids(normalized_graph_data)
    trigger_payload = _build_trigger_payload(
        user_message,
        runtime_messages,
        last_user_attachments,
    )

    state = types.SimpleNamespace(user_message=user_message)
    execution_ctx = types.SimpleNamespace(entry_node_ids=entry_node_ids, stop_run=False)
    cancel_handle = ChatFlowCancelHandle(run_handle, execution_ctx)
    run_control.register_active_run(assistant_msg_id, cancel_handle)
    services = types.SimpleNamespace(
        run_handle=cancel_handle,
        extra_tool_ids=list(extra_tool_ids or []),
        tool_registry=registry,
        chat_output=types.SimpleNamespace(primary_agent_id=None),
        chat_input=types.SimpleNamespace(
            last_user_message=user_message,
            last_user_attachments=last_user_attachments,
            runtime_messages=runtime_messages,
        ),
        expression_context={"trigger": trigger_payload},
        execution=execution_ctx,
    )
    _apply_runtime_config(normalized_graph_data, services, mode="chat")
    chat_output = getattr(services, "chat_output", None)
    if (
        chat_output is not None
        and not getattr(chat_output, "primary_agent_id", None)
        and _count_agent_nodes(normalized_graph_data) > 1
    ):
        setattr(chat_output, "group_by_node", True)

    context = types.SimpleNamespace(
        run_id=str(uuid.uuid4()),
        chat_id=chat_id,
        state=state,
        services=services,
    )

    accumulator = ContentAccumulator([] if ephemeral else load_initial_fn(assistant_msg_id))
    final_output: DataValue | None = None
    primary_output: DataValue | None = None
    primary_agent_id = getattr(chat_output, "primary_agent_id", None) if chat_output else None
    runtime_run_flow = run_flow_impl or run_flow
    had_error = False
    was_cancelled = False
    terminal_event: str | None = None

    def _send_flow_node_event(event_name: str, payload: dict[str, Any]) -> None:
        emit_chat_event(
            ch,
            event_name,
            content=json.dumps(payload, default=str),
            allow_unknown=True,
        )

    async def _finalize_cancelled() -> None:
        nonlocal was_cancelled, terminal_event, trace_status
        was_cancelled = True
        terminal_event = EVENT_RUN_CANCELLED
        trace_status = "cancelled"
        accumulator.flush_text()
        accumulator.flush_reasoning()
        for tool in _deny_pending_approvals(accumulator.content_blocks):
            emit_chat_event(ch, EVENT_TOOL_APPROVAL_RESOLVED, tool=tool)
        for tool_block in _fail_inflight_tool_calls(accumulator.content_blocks):
            emit_chat_event(
                ch,
                EVENT_TOOL_CALL_COMPLETED,
                tool={
                    "id": tool_block.get("id"),
                    "toolName": tool_block.get("toolName"),
                    "toolArgs": tool_block.get("toolArgs") or {},
                    "toolResult": tool_block.get("toolResult"),
                    "failed": True,
                },
            )
        accumulator.flush_all_member_runs(cancelled=True)
        await _persist_accumulator(save_content, assistant_msg_id, accumulator, final=True)
        if not ephemeral:
            await asyncio.to_thread(_mark_message_complete, assistant_msg_id)
        emit_chat_event(ch, EVENT_RUN_CANCELLED)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)

    try:
        async for item in runtime_run_flow(normalized_graph_data, context):
            if isinstance(item, NodeEvent):
                trace_recorder.record(
                    event_type=f"runtime.node.{item.event_type}",
                    payload=item.data or {},
                    node_id=item.node_id,
                    node_type=item.node_type,
                    run_id=item.run_id,
                )
                if item.event_type == "started":
                    accumulator.flush_text()
                    accumulator.flush_reasoning()
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_STARTED,
                        {"nodeId": item.node_id, "nodeType": item.node_type},
                    )
                elif item.event_type == "progress":
                    if primary_agent_id and item.node_id != primary_agent_id:
                        continue
                    token = (item.data or {}).get("token", "")
                    if token and accumulator.append_text(str(token)):
                        emit_chat_event(ch, EVENT_RUN_CONTENT, content=str(token))
                        await _persist_accumulator(save_content, assistant_msg_id, accumulator)
                elif item.event_type == "agent_run_id":
                    run_id = str((item.data or {}).get("run_id") or "")
                    if run_id:
                        trace_recorder.set_root_run_id(run_id)
                        run_control.set_active_run_id(assistant_msg_id, run_id)
                        if chat_id:
                            await broadcaster.update_stream_run_id(chat_id, run_id)
                elif item.event_type == "agent_event":
                    event_data = item.data or {}
                    if (
                        primary_agent_id
                        and item.node_id != primary_agent_id
                        and not event_data.get("memberRunId")
                    ):
                        continue

                    if _is_delegation_agent_event(event_data):
                        continue

                    _ensure_tool_call_completed_payload(event_data, chat_id or None)
                    chat_event = _chat_event_from_agent_runtime_event(event_data)
                    if chat_event is not None:
                        ch.send_model(chat_event)

                    if accumulator.apply_agent_event(event_data):
                        await _persist_accumulator(save_content, assistant_msg_id, accumulator)

                    event_name = str(event_data.get("event") or "")
                    if event_name == EVENT_TOOL_APPROVAL_REQUIRED and chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")
                    elif event_name == EVENT_TOOL_APPROVAL_RESOLVED and chat_id:
                        await broadcaster.update_stream_status(chat_id, "streaming")
                elif item.event_type == "cancelled":
                    await _finalize_cancelled()
                    return
                elif item.event_type == "completed":
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_COMPLETED,
                        {"nodeId": item.node_id, "nodeType": item.node_type},
                    )
                elif item.event_type == "result":
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_RESULT,
                        {
                            "nodeId": item.node_id,
                            "nodeType": item.node_type,
                            "outputs": (item.data or {}).get("outputs", {}),
                        },
                    )
                    if primary_agent_id and item.node_id == primary_agent_id:
                        primary_output = _pick_text_output(
                            _coerce_event_outputs((item.data or {}).get("outputs", {}))
                        )
                elif item.event_type == "error":
                    error_msg = (item.data or {}).get("error", "Unknown node error")
                    error_text = f"[{item.node_type}] {error_msg}"
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_ERROR,
                        {
                            "nodeId": item.node_id,
                            "nodeType": item.node_type,
                            "error": str(error_msg),
                        },
                    )
                    if (item.data or {}).get("on_error") == "continue":
                        continue
                    trace_status = "error"
                    trace_error = error_text
                    accumulator.flush_text()
                    accumulator.append_error(error_text)
                    emit_chat_event(ch, EVENT_RUN_ERROR, content=error_text)
                    await _persist_accumulator(
                        save_content,
                        assistant_msg_id,
                        accumulator,
                        final=True,
                    )
                    had_error = True
                    terminal_event = EVENT_RUN_ERROR
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "error", error_text)
                        await broadcaster.unregister_stream(chat_id)
                    return
            elif isinstance(item, ExecutionResult):
                trace_recorder.record(
                    event_type="runtime.execution_result",
                    payload={
                        "outputs": {
                            key: {"type": value.type, "value": value.value}
                            for key, value in item.outputs.items()
                        }
                    },
                )
                final_output = _pick_text_output(item.outputs)

        if terminal_event is not None:
            return

        accumulator.flush_text()
        accumulator.flush_reasoning()
        accumulator.flush_all_member_runs()

        if cancel_handle.is_cancel_requested():
            await _finalize_cancelled()
            return

        has_main_text = any(
            block.get("type") == "text" for block in accumulator.content_blocks
        )
        has_member_runs = any(
            block.get("type") == "member_run" for block in accumulator.content_blocks
        )
        if not has_main_text and not has_member_runs:
            text = ""
            if primary_agent_id and primary_output is not None:
                final_value = primary_output.value
                text = str(final_value) if final_value is not None else ""
            elif final_output is not None:
                final_value = final_output.value
                text = str(final_value) if final_value is not None else ""
            if text:
                accumulator.content_blocks.append({"type": "text", "content": text})
                emit_chat_event(ch, EVENT_RUN_CONTENT, content=text)

        await _persist_accumulator(save_content, assistant_msg_id, accumulator, final=True)

        if not ephemeral:
            await asyncio.to_thread(_mark_message_complete, assistant_msg_id)

        terminal_event = EVENT_RUN_COMPLETED
        trace_status = "completed"
        emit_chat_event(ch, EVENT_RUN_COMPLETED)

        if hasattr(ch, "flush_broadcasts"):
            await ch.flush_broadcasts()

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
    except Exception as exc:
        logger.error("[flow_stream] Exception: %s", exc)
        traceback.print_exc()

        if terminal_event is not None:
            return

        accumulator.flush_text()
        accumulator.flush_reasoning()
        accumulator.flush_all_member_runs()

        error_msg = extract_error_message(str(exc))
        trace_status = "error"
        trace_error = error_msg
        accumulator.append_error(error_msg)
        await _persist_accumulator(save_content, assistant_msg_id, accumulator, final=True)
        emit_chat_event(ch, EVENT_RUN_ERROR, content=error_msg)
        had_error = True
        terminal_event = EVENT_RUN_ERROR

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(exc))
            await broadcaster.unregister_stream(chat_id)
    finally:
        run_control.remove_active_run(assistant_msg_id)
        run_control.clear_early_cancel(assistant_msg_id)
        trace_recorder.finish(status=trace_status, error_message=trace_error)

        if not had_error and not was_cancelled and not ephemeral:
            with db.db_session() as sess:
                message = sess.get(db.Message, assistant_msg_id)
                if message and not message.is_complete:
                    db.mark_message_complete(sess, assistant_msg_id)



async def run_graph_chat_runtime(
    graph_data: dict[str, Any],
    messages: list[ChatMessage],
    assistant_msg_id: str,
    channel: Channel,
    *,
    chat_id: str,
    ephemeral: bool,
    agent_id: str | None = None,
    extra_tool_ids: list[str] | None = None,
    flow_stream_handler: FlowStreamHandler | None = None,
) -> None:
    _require_user_message(messages)
    await ensure_mcp_initialized()

    handler = flow_stream_handler or handle_flow_stream

    await handler(
        graph_data,
        None,
        messages,
        assistant_msg_id,
        channel,
        chat_id=chat_id,
        ephemeral=ephemeral,
        agent_id=agent_id,
        extra_tool_ids=extra_tool_ids,
    )


__all__ = [
    "FlowRunHandle",
    "handle_flow_stream",
    "run_graph_chat_runtime",
]
