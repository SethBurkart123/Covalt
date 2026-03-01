from __future__ import annotations

import types
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Literal

from nodes._types import NodeEvent
from zynk import Channel

from ...services.runtime_events import (
    EVENT_FLOW_NODE_COMPLETED,
    EVENT_FLOW_NODE_ERROR,
    EVENT_FLOW_NODE_RESULT,
    EVENT_FLOW_NODE_STARTED,
    EVENT_RUN_CANCELLED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
    EVENT_RUN_STARTED,
    emit_chat_event,
)


@dataclass
class FlowRunPromptInput:
    message: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    messages: Optional[List[Any]] = None
    attachments: Optional[List[Dict[str, Any]]] = None


@dataclass
class StreamFlowRunInput:
    channel: Channel
    agent_id: str
    mode: Literal["execute", "runFrom"]
    target_node_id: str
    cached_outputs: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None
    prompt_input: Optional[FlowRunPromptInput] = None
    node_ids: Optional[List[str]] = None


class FlowRunCancelHandle:
    def __init__(self, run_handle: Any, execution_ctx: Any | None) -> None:
        self._run_handle = run_handle
        self._execution_ctx = execution_ctx

    def bind_agent(self, agent: Any) -> None:
        self._run_handle.bind_agent(agent)

    def set_run_id(self, run_id: str) -> None:
        self._run_handle.set_run_id(run_id)

    def request_cancel(self) -> None:
        if self._execution_ctx is not None:
            setattr(self._execution_ctx, "stop_run", True)
        self._run_handle.request_cancel()

    def cancel_run(self, run_id: str) -> None:
        if self._execution_ctx is not None:
            setattr(self._execution_ctx, "stop_run", True)
        self._run_handle.cancel_run(run_id)

    def is_cancel_requested(self) -> bool:
        return self._run_handle.is_cancel_requested()


@dataclass
class StreamFlowRunDependencies:
    get_agent_data: Callable[[str], Optional[Dict[str, Any]]]
    build_trigger_payload: Callable[[str, list[dict[str, Any]], list[dict[str, Any]], list[Any]], dict[str, Any]]
    create_run_handle: Callable[[], Any]
    get_tool_registry: Callable[[], Any]
    register_active_run: Callable[[str, Any], None]
    consume_early_cancel: Callable[[str], bool]
    remove_active_run: Callable[[str], Optional[tuple[Optional[str], Any]]]
    clear_early_cancel: Callable[[str], None]
    run_flow: Callable[..., Any]
    emit_run_error: Callable[[Channel, str], None]
    logger: Any


async def execute_stream_flow_run(
    input_data: StreamFlowRunInput,
    deps: StreamFlowRunDependencies,
) -> None:
    agent_data = deps.get_agent_data(input_data.agent_id)
    if not agent_data:
        deps.emit_run_error(input_data.channel, f"Agent '{input_data.agent_id}' not found")
        return

    prompt = input_data.prompt_input or FlowRunPromptInput()
    message = prompt.message or ""
    history = prompt.history or []
    messages = prompt.messages or []
    attachments = prompt.attachments or []

    trigger_payload = deps.build_trigger_payload(
        message,
        history,
        attachments,
        messages,
    )

    run_id = str(uuid.uuid4())
    scope_payload: dict[str, Any] = {
        "mode": input_data.mode,
        "target_node_ids": [input_data.target_node_id],
    }
    if input_data.node_ids is not None:
        scope_payload["node_ids"] = input_data.node_ids

    execution_ctx = types.SimpleNamespace(
        scope=scope_payload,
        cached_outputs=input_data.cached_outputs or {},
        stop_run=False,
    )

    run_handle = deps.create_run_handle()
    cancel_handle = FlowRunCancelHandle(run_handle, execution_ctx)

    services = types.SimpleNamespace(
        run_handle=cancel_handle,
        extra_tool_ids=[],
        tool_registry=deps.get_tool_registry(),
        chat_input=types.SimpleNamespace(
            last_user_message=message,
            history=history,
            messages=messages,
            last_user_attachments=attachments,
        ),
        expression_context={"trigger": trigger_payload},
        execution=execution_ctx,
    )
    context = types.SimpleNamespace(
        run_id=run_id,
        chat_id=None,
        state=types.SimpleNamespace(user_message=message),
        services=services,
    )

    deps.register_active_run(run_id, cancel_handle)
    emit_chat_event(input_data.channel, EVENT_RUN_STARTED, sessionId=run_id)

    try:
        if deps.consume_early_cancel(run_id):
            emit_chat_event(input_data.channel, EVENT_RUN_CANCELLED)
            return

        async for item in deps.run_flow(agent_data["graph_data"], context):
            if not isinstance(item, NodeEvent):
                continue

            if item.event_type == "agent_event":
                payload = dict(item.data or {})
                event_name = str(payload.pop("event", "agent_event"))
                emit_chat_event(
                    input_data.channel,
                    event_name,
                    allow_unknown=True,
                    **payload,
                )
                continue

            if item.event_type == "progress":
                token = (item.data or {}).get("token", "")
                if token:
                    emit_chat_event(input_data.channel, EVENT_RUN_CONTENT, content=token)
                continue

            if item.event_type == "cancelled":
                emit_chat_event(input_data.channel, EVENT_RUN_CANCELLED)
                return

            if item.event_type == "started":
                emit_chat_event(
                    input_data.channel,
                    EVENT_FLOW_NODE_STARTED,
                    nodeId=item.node_id,
                    nodeType=item.node_type,
                )
                continue

            if item.event_type == "completed":
                emit_chat_event(
                    input_data.channel,
                    EVENT_FLOW_NODE_COMPLETED,
                    nodeId=item.node_id,
                    nodeType=item.node_type,
                )
                continue

            if item.event_type == "result":
                emit_chat_event(
                    input_data.channel,
                    EVENT_FLOW_NODE_RESULT,
                    nodeId=item.node_id,
                    nodeType=item.node_type,
                    outputs=(item.data or {}).get("outputs", {}),
                )
                continue

            if item.event_type == "error":
                emit_chat_event(
                    input_data.channel,
                    EVENT_FLOW_NODE_ERROR,
                    nodeId=item.node_id,
                    nodeType=item.node_type,
                    error=(item.data or {}).get("error", "Unknown node error"),
                )
                emit_chat_event(input_data.channel, EVENT_RUN_ERROR, content="Node error")
                return

        if cancel_handle.is_cancel_requested() or execution_ctx.stop_run:
            emit_chat_event(input_data.channel, EVENT_RUN_CANCELLED)
        else:
            emit_chat_event(input_data.channel, EVENT_RUN_COMPLETED)
    except Exception as exc:
        deps.logger.error(f"[stream_flow_run] Error: {exc}")
        emit_chat_event(input_data.channel, EVENT_RUN_ERROR, content=str(exc))
    finally:
        deps.remove_active_run(run_id)
        deps.clear_early_cancel(run_id)
