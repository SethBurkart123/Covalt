from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

from pydantic import BaseModel
from rich.logging import RichHandler
from zynk import Channel, command

from .. import db
from ..application.conversation import (
    FlowRunPromptInput as FlowRunPromptInputDTO,
)
from ..application.conversation import (
    StartRunDependencies,
    StartRunInput,
    StreamAgentRunDependencies,
    StreamAgentRunInput,
    StreamFlowRunDependencies,
    StreamFlowRunInput,
    execute_start_run,
    execute_stream_agent_run,
    execute_stream_flow_run,
)
from ..application.tooling import (
    CancelFlowRunDependencies,
    CancelFlowRunInput,
    CancelRunDependencies,
    CancelRunInput,
    RespondToToolDecisionDependencies,
    execute_cancel_flow_run,
    execute_cancel_run,
    execute_respond_to_tool_decision,
)
from ..application.tooling import (
    RespondToToolDecisionInput as RespondToToolDecisionInputDTO,
)
from ..models.chat import ChatEvent, ChatMessage
from ..services.chat.chat_attachments import prepare_stream_attachments
from ..services.chat.chat_graph_config import _build_trigger_payload, get_graph_data_for_chat
from ..services.chat.conversation_store import (
    ensure_chat_initialized,
    get_active_leaf_message_id,
)
from ..services.chat.conversation_store import (
    init_assistant_message as init_assistant_msg,
)
from ..services.chat.conversation_store import (
    save_user_message as save_user_msg,
)
from ..services.flows.agent_manager import get_agent_manager
from ..services.flows.flow_executor import run_flow
from ..services.streaming import run_control
from ..services.streaming import stream_broadcaster as broadcaster
from ..services.streaming.chat_stream import FlowRunHandle, run_graph_chat_runtime
from ..services.streaming.conversation_run_service import (
    emit_run_start_events,
    handle_streaming_run_error,
    validate_model_options,
)
from ..services.streaming.runtime_events import (
    EVENT_ASSISTANT_MESSAGE_ID,
    EVENT_RUN_ERROR,
    EVENT_RUN_STARTED,
    EVENT_STREAM_NOT_ACTIVE,
    EVENT_STREAM_SUBSCRIBED,
    emit_chat_event,
)
from ..services.tools.tool_registry import get_tool_registry

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)


class AttachmentInput(BaseModel):
    id: str
    type: str
    name: str
    mime_type: str
    size: int
    data: str

    @property
    def mimeType(self) -> str:
        return self.mime_type


class AttachmentMeta(BaseModel):
    id: str
    type: str
    name: str
    mime_type: str
    size: int

    @property
    def mimeType(self) -> str:
        return self.mime_type


class StreamChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    model_id: str | None = None
    model_options: dict[str, Any] | None = None
    chat_id: str | None = None
    tool_ids: list[str] = []
    attachments: list[AttachmentMeta] = []
    variables: dict[str, Any] | None = None


class CancelRunRequest(BaseModel):
    message_id: str


class RespondToToolDecisionInput(BaseModel):
    run_id: str
    tool_call_id: str
    selected_option: str
    edited_args: dict[str, Any] | None = None
    cancelled: bool = False


def _wire_get(data: dict[str, Any], snake_key: str, camel_key: str) -> Any:
    return data.get(snake_key, data.get(camel_key))


def _message_attachments(data: dict[str, Any]) -> list[dict[str, Any]] | None:
    attachments = data.get("attachments")
    if not isinstance(attachments, list):
        return attachments
    return [
        {
            **attachment,
            "mimeType": _wire_get(attachment, "mime_type", "mimeType"),
        }
        if isinstance(attachment, dict)
        else attachment
        for attachment in attachments
    ]


def _record_tool_decision(
    tool_call_id: str,
    *,
    selected_option: str,
    edited_args: dict[str, Any] | None,
    cancelled: bool,
) -> bool:
    return run_control.record_tool_decision(
        tool_call_id,
        selected_option=selected_option,
        edited_args=edited_args,
        cancelled=cancelled,
    )


def _mark_message_complete(message_id: str) -> None:
    with db.db_session() as sess:
        db.mark_message_complete(sess, message_id)


def _build_respond_to_tool_decision_dependencies() -> RespondToToolDecisionDependencies:
    return RespondToToolDecisionDependencies(record_tool_decision=_record_tool_decision)


def _build_cancel_run_dependencies() -> CancelRunDependencies:
    return CancelRunDependencies(
        get_active_run=run_control.get_active_run,
        mark_early_cancel=run_control.mark_early_cancel,
        mark_message_complete=_mark_message_complete,
        remove_active_run=run_control.remove_active_run,
        cancel_sessions_for_run=run_control.cancel_sessions_for_run,
        logger=logger,
    )


def _build_cancel_flow_run_dependencies() -> CancelFlowRunDependencies:
    return CancelFlowRunDependencies(
        get_active_run=run_control.get_active_run,
        mark_early_cancel=run_control.mark_early_cancel,
        remove_active_run=run_control.remove_active_run,
        cancel_sessions_for_run=run_control.cancel_sessions_for_run,
        logger=logger,
    )


@command
async def respond_to_tool_decision(body: RespondToToolDecisionInput) -> dict:
    return execute_respond_to_tool_decision(
        RespondToToolDecisionInputDTO(
            run_id=body.run_id,
            tool_call_id=body.tool_call_id,
            selected_option=body.selected_option,
            edited_args=body.edited_args,
            cancelled=body.cancelled,
        ),
        _build_respond_to_tool_decision_dependencies(),
    )


@command
async def cancel_run(body: CancelRunRequest) -> dict:
    return execute_cancel_run(
        CancelRunInput(message_id=body.message_id),
        _build_cancel_run_dependencies(),
    )


@command
async def cancel_flow_run(body: CancelFlowRunRequest) -> dict:
    return execute_cancel_flow_run(
        CancelFlowRunInput(run_id=body.run_id),
        _build_cancel_flow_run_dependencies(),
    )


def _prepare_stream_attachments_for_start_run(
    chat_id: str,
    attachments: list[AttachmentMeta],
    source_ref: str | None,
):
    return prepare_stream_attachments(chat_id, attachments, source_ref=source_ref)


def _emit_run_started(
    channel: Channel[ChatEvent],
    chat_id: str,
    file_renames: dict[str, str] | None,
) -> None:
    emit_chat_event(
        channel,
        EVENT_RUN_STARTED,
        sessionId=chat_id,
        fileRenames=file_renames or {},
    )


def _emit_assistant_message_id(channel: Channel[ChatEvent], assistant_msg_id: str) -> None:
    emit_chat_event(channel, EVENT_ASSISTANT_MESSAGE_ID, content=assistant_msg_id)


def _get_graph_data(chat_id: str, model_id: str | None, model_options: dict[str, Any]) -> dict[str, Any]:
    return get_graph_data_for_chat(
        chat_id,
        model_id,
        model_options=model_options,
    )


def _build_start_run_dependencies() -> StartRunDependencies:
    return StartRunDependencies(
        validate_model_options=validate_model_options,
        ensure_chat_initialized=ensure_chat_initialized,
        prepare_stream_attachments=_prepare_stream_attachments_for_start_run,
        get_active_leaf_message_id=get_active_leaf_message_id,
        save_user_msg=save_user_msg,
        emit_run_started=_emit_run_started,
        init_assistant_msg=init_assistant_msg,
        emit_assistant_message_id=_emit_assistant_message_id,
        get_graph_data_for_chat=_get_graph_data,
        run_graph_chat_runtime=run_graph_chat_runtime,
        handle_streaming_run_error=handle_streaming_run_error,
        logger=logger,
    )


@command
async def stream_chat(
    channel: Channel[ChatEvent],
    body: StreamChatRequest,
) -> None:
    messages: list[ChatMessage] = [
        ChatMessage(
            id=m.get("id"),
            role=m.get("role"),
            content=m.get("content", ""),
            createdAt=_wire_get(m, "created_at", "createdAt"),
            toolCalls=_wire_get(m, "tool_calls", "toolCalls"),
            attachments=_message_attachments(m),
        )
        for m in body.messages
    ]

    await execute_start_run(
        StartRunInput(
            channel=channel,
            messages=messages,
            model_id=body.model_id,
            model_options=body.model_options,
            chat_id=body.chat_id,
            tool_ids=body.tool_ids,
            attachments=body.attachments,
            variables=body.variables,
        ),
        _build_start_run_dependencies(),
    )


class StreamAgentChatRequest(BaseModel):
    agent_id: str
    messages: list[dict[str, Any]]
    chat_id: str | None = None
    ephemeral: bool = False
    variables: dict[str, Any] | None = None


class FlowRunPromptInput(BaseModel):
    message: str | None = None
    history: list[dict[str, Any]] | None = None
    messages: list[Any] | None = None
    attachments: list[dict[str, Any]] | None = None


class StreamFlowRunRequest(BaseModel):
    agent_id: str
    mode: Literal["execute", "runFrom"]
    target_node_id: str
    cached_outputs: dict[str, dict[str, Any]] | None = None
    prompt_input: FlowRunPromptInput | None = None
    node_ids: list[str] | None = None


class CancelFlowRunRequest(BaseModel):
    run_id: str


def _build_stream_agent_run_dependencies() -> StreamAgentRunDependencies:
    return StreamAgentRunDependencies(
        get_agent_data=lambda agent_id: get_agent_manager().get_agent(agent_id),
        emit_run_error=lambda channel, content: emit_chat_event(channel, EVENT_RUN_ERROR, content=content),
        ensure_chat_initialized=ensure_chat_initialized,
        get_active_leaf_message_id=get_active_leaf_message_id,
        save_user_message=save_user_msg,
        init_assistant_message=init_assistant_msg,
        emit_run_start_events=emit_run_start_events,
        run_graph_chat_runtime=run_graph_chat_runtime,
        handle_streaming_run_error=handle_streaming_run_error,
        logger=logger,
    )


@command
async def stream_agent_chat(
    channel: Channel[ChatEvent],
    body: StreamAgentChatRequest,
) -> None:
    messages: list[ChatMessage] = [
        ChatMessage(
            id=m.get("id"),
            role=m.get("role"),
            content=m.get("content", ""),
            createdAt=_wire_get(m, "created_at", "createdAt"),
            toolCalls=_wire_get(m, "tool_calls", "toolCalls"),
            attachments=_message_attachments(m),
        )
        for m in body.messages
    ]

    await execute_stream_agent_run(
        StreamAgentRunInput(
            channel=channel,
            agent_id=body.agent_id,
            messages=messages,
            chat_id=body.chat_id,
            ephemeral=body.ephemeral,
            variables=body.variables,
        ),
        _build_stream_agent_run_dependencies(),
    )


def _build_stream_flow_run_dependencies() -> StreamFlowRunDependencies:
    return StreamFlowRunDependencies(
        get_agent_data=lambda agent_id: get_agent_manager().get_agent(agent_id),
        build_trigger_payload=_build_trigger_payload,
        create_run_handle=FlowRunHandle,
        get_tool_registry=get_tool_registry,
        register_active_run=run_control.register_active_run,
        consume_early_cancel=run_control.consume_early_cancel,
        remove_active_run=run_control.remove_active_run,
        clear_early_cancel=run_control.clear_early_cancel,
        run_flow=run_flow,
        emit_run_error=lambda channel, content: emit_chat_event(channel, EVENT_RUN_ERROR, content=content),
        logger=logger,
    )


@command
async def stream_flow_run(
    channel: Channel[ChatEvent],
    body: StreamFlowRunRequest,
) -> None:
    await execute_stream_flow_run(
        StreamFlowRunInput(
            channel=channel,
            agent_id=body.agent_id,
            mode=body.mode,
            target_node_id=body.target_node_id,
            cached_outputs=body.cached_outputs,
            prompt_input=FlowRunPromptInputDTO(
                message=body.prompt_input.message if body.prompt_input else None,
                history=body.prompt_input.history if body.prompt_input else None,
                messages=body.prompt_input.messages if body.prompt_input else None,
                attachments=body.prompt_input.attachments if body.prompt_input else None,
            )
            if body.prompt_input
            else None,
            node_ids=body.node_ids,
        ),
        _build_stream_flow_run_dependencies(),
    )



class ConnectStreamRequest(BaseModel):
    chat_id: str




@command
async def connect_stream(channel: Channel[ChatEvent], body: ConnectStreamRequest) -> None:
    """Atomically check if a stream exists and subscribe in one call."""
    result = await broadcaster.get_or_subscribe(body.chat_id)
    if result is None:
        emit_chat_event(channel, EVENT_STREAM_NOT_ACTIVE, content=body.chat_id)
        return

    emit_chat_event(
        channel,
        EVENT_STREAM_SUBSCRIBED,
        content=body.chat_id,
        status=result.status,
        messageId=result.message_id,
        errorMessage=result.error_message,
    )

    try:
        while True:
            event = await result.queue.get()
            if event is None:
                break
            event_name = str(event.get("event") or "")
            if not event_name:
                continue
            emit_chat_event(
                channel,
                event_name,
                allow_unknown=True,
                **{k: v for k, v in event.items() if k != "event"},
            )
    except asyncio.CancelledError:
        pass
    finally:
        await broadcaster.unsubscribe(body.chat_id, result.queue)
