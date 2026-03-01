from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Literal

from pydantic import BaseModel
from rich.logging import RichHandler

from .. import db

from zynk import Channel, command

from ..application.conversation import (
    FlowRunPromptInput as FlowRunPromptInputDTO,
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
    RespondToToolApprovalDependencies,
    RespondToToolApprovalInput as RespondToToolApprovalInputDTO,
    execute_cancel_flow_run,
    execute_cancel_run,
    execute_respond_to_tool_approval,
)
from ..models.chat import ChatMessage
from ..services.runtime_events import (
    EVENT_ASSISTANT_MESSAGE_ID,
    EVENT_RUN_ERROR,
    EVENT_RUN_STARTED,
    EVENT_STREAM_NOT_ACTIVE,
    EVENT_STREAM_SUBSCRIBED,
    emit_chat_event,
)
from ..services.agent_manager import get_agent_manager
from ..services.chat_attachments import prepare_stream_attachments
from ..services.chat_graph_runner import (
    get_graph_data_for_chat,
    run_graph_chat_runtime,
    _build_trigger_payload,
    FlowRunHandle,
)
from ..services.conversation_store import (
    ensure_chat_initialized,
    init_assistant_message as init_assistant_msg,
    save_user_message as save_user_msg,
    get_active_leaf_message_id,
)
from ..services.flow_executor import run_flow
from ..services.tool_registry import get_tool_registry
from ..services import run_control
from ..services import stream_broadcaster as broadcaster
from ..services.conversation_run_service import (
    validate_model_options,
    emit_run_start_events,
    handle_streaming_run_error,
)
import logging

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
    mimeType: str
    size: int
    data: str


class AttachmentMeta(BaseModel):
    id: str
    type: str
    name: str
    mimeType: str
    size: int


class StreamChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    modelId: Optional[str] = None
    modelOptions: Optional[Dict[str, Any]] = None
    chatId: Optional[str] = None
    toolIds: List[str] = []
    attachments: List[AttachmentMeta] = []


class CancelRunRequest(BaseModel):
    messageId: str


class RespondToToolApprovalInput(BaseModel):
    runId: str
    approved: bool
    toolDecisions: Optional[Dict[str, bool]] = None
    editedArgs: Optional[Dict[str, Dict[str, Any]]] = None


def _set_approval_response(
    run_id: str,
    approved: bool,
    tool_decisions: Dict[str, bool],
    edited_args: Dict[str, Dict[str, Any]],
) -> None:
    run_control.set_approval_response(
        run_id,
        approved=approved,
        tool_decisions=tool_decisions,
        edited_args=edited_args,
    )


def _mark_message_complete(message_id: str) -> None:
    with db.db_session() as sess:
        db.mark_message_complete(sess, message_id)


def _build_respond_to_tool_approval_dependencies() -> RespondToToolApprovalDependencies:
    return RespondToToolApprovalDependencies(set_approval_response=_set_approval_response)


def _build_cancel_run_dependencies() -> CancelRunDependencies:
    return CancelRunDependencies(
        get_active_run=run_control.get_active_run,
        mark_early_cancel=run_control.mark_early_cancel,
        mark_message_complete=_mark_message_complete,
        remove_active_run=run_control.remove_active_run,
        logger=logger,
    )


def _build_cancel_flow_run_dependencies() -> CancelFlowRunDependencies:
    return CancelFlowRunDependencies(
        get_active_run=run_control.get_active_run,
        mark_early_cancel=run_control.mark_early_cancel,
        remove_active_run=run_control.remove_active_run,
        logger=logger,
    )


@command
async def respond_to_tool_approval(body: RespondToToolApprovalInput) -> dict:
    return execute_respond_to_tool_approval(
        RespondToToolApprovalInputDTO(
            run_id=body.runId,
            approved=body.approved,
            tool_decisions=body.toolDecisions,
            edited_args=body.editedArgs,
        ),
        _build_respond_to_tool_approval_dependencies(),
    )


@command
async def cancel_run(body: CancelRunRequest) -> dict:
    return execute_cancel_run(
        CancelRunInput(message_id=body.messageId),
        _build_cancel_run_dependencies(),
    )


@command
async def cancel_flow_run(body: CancelFlowRunRequest) -> dict:
    return execute_cancel_flow_run(
        CancelFlowRunInput(run_id=body.runId),
        _build_cancel_flow_run_dependencies(),
    )


def _prepare_stream_attachments_for_start_run(
    chat_id: str,
    attachments: List[AttachmentMeta],
    source_ref: Optional[str],
):
    return prepare_stream_attachments(chat_id, attachments, source_ref=source_ref)


def _emit_run_started(
    channel: Channel,
    chat_id: str,
    file_renames: Optional[Dict[str, str]],
) -> None:
    emit_chat_event(
        channel,
        EVENT_RUN_STARTED,
        sessionId=chat_id,
        fileRenames=file_renames or {},
    )


def _emit_assistant_message_id(channel: Channel, assistant_msg_id: str) -> None:
    emit_chat_event(channel, EVENT_ASSISTANT_MESSAGE_ID, content=assistant_msg_id)


def _get_graph_data(chat_id: str, model_id: Optional[str], model_options: Dict[str, Any]) -> Dict[str, Any]:
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
    channel: Channel,
    body: StreamChatRequest,
) -> None:
    messages: List[ChatMessage] = [
        ChatMessage(
            id=m.get("id"),
            role=m.get("role"),
            content=m.get("content", ""),
            createdAt=m.get("createdAt"),
            toolCalls=m.get("toolCalls"),
            attachments=m.get("attachments"),
        )
        for m in body.messages
    ]

    await execute_start_run(
        StartRunInput(
            channel=channel,
            messages=messages,
            model_id=body.modelId,
            model_options=body.modelOptions,
            chat_id=body.chatId,
            tool_ids=body.toolIds,
            attachments=body.attachments,
        ),
        _build_start_run_dependencies(),
    )


class StreamAgentChatRequest(BaseModel):
    agentId: str
    messages: List[Dict[str, Any]]
    chatId: Optional[str] = None
    ephemeral: bool = False


class FlowRunPromptInput(BaseModel):
    message: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    messages: Optional[List[Any]] = None
    attachments: Optional[List[Dict[str, Any]]] = None


class StreamFlowRunRequest(BaseModel):
    agentId: str
    mode: Literal["execute", "runFrom"]
    targetNodeId: str
    cachedOutputs: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None
    promptInput: Optional[FlowRunPromptInput] = None
    nodeIds: Optional[List[str]] = None


class CancelFlowRunRequest(BaseModel):
    runId: str


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
    channel: Channel,
    body: StreamAgentChatRequest,
) -> None:
    messages: List[ChatMessage] = [
        ChatMessage(
            id=m.get("id"),
            role=m.get("role"),
            content=m.get("content", ""),
            createdAt=m.get("createdAt"),
            toolCalls=m.get("toolCalls"),
            attachments=m.get("attachments"),
        )
        for m in body.messages
    ]

    await execute_stream_agent_run(
        StreamAgentRunInput(
            channel=channel,
            agent_id=body.agentId,
            messages=messages,
            chat_id=body.chatId,
            ephemeral=body.ephemeral,
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
    channel: Channel,
    body: StreamFlowRunRequest,
) -> None:
    await execute_stream_flow_run(
        StreamFlowRunInput(
            channel=channel,
            agent_id=body.agentId,
            mode=body.mode,
            target_node_id=body.targetNodeId,
            cached_outputs=body.cachedOutputs,
            prompt_input=FlowRunPromptInputDTO(
                message=body.promptInput.message if body.promptInput else None,
                history=body.promptInput.history if body.promptInput else None,
                messages=body.promptInput.messages if body.promptInput else None,
                attachments=body.promptInput.attachments if body.promptInput else None,
            )
            if body.promptInput
            else None,
            node_ids=body.nodeIds,
        ),
        _build_stream_flow_run_dependencies(),
    )


class ActiveStreamInfo(BaseModel):
    chatId: str
    messageId: str
    status: str
    errorMessage: Optional[str] = None


class ActiveStreamsResponse(BaseModel):
    streams: List[ActiveStreamInfo]


class SubscribeToStreamRequest(BaseModel):
    chatId: str


class ClearStreamRequest(BaseModel):
    chatId: str


@command
async def get_active_streams() -> ActiveStreamsResponse:
    streams = await broadcaster.get_all_active_streams()
    return ActiveStreamsResponse(
        streams=[
            ActiveStreamInfo(
                chatId=s["chatId"],
                messageId=s["messageId"],
                status=s["status"],
                errorMessage=s.get("errorMessage"),
            )
            for s in streams
        ]
    )


@command
async def subscribe_to_stream(channel: Channel, body: SubscribeToStreamRequest) -> None:
    queue = await broadcaster.subscribe(body.chatId)
    if queue is None:
        emit_chat_event(channel, EVENT_STREAM_NOT_ACTIVE, content=body.chatId)
        return

    emit_chat_event(channel, EVENT_STREAM_SUBSCRIBED, content=body.chatId)
    try:
        while True:
            event = await queue.get()
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
        await broadcaster.unsubscribe(body.chatId, queue)


@command
async def clear_stream_record(body: ClearStreamRequest) -> dict:
    await broadcaster.clear_stream_record(body.chatId)
    return {"success": True}
