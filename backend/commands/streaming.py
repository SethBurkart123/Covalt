from __future__ import annotations

import asyncio
import json
import uuid
import types
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional, Literal

from pydantic import BaseModel
from rich.logging import RichHandler

from zynk import Channel, command

from .. import db
from ..models.chat import Attachment, ChatMessage
from ..services.runtime_events import (
    EVENT_ASSISTANT_MESSAGE_ID,
    EVENT_FLOW_NODE_COMPLETED,
    EVENT_FLOW_NODE_ERROR,
    EVENT_FLOW_NODE_RESULT,
    EVENT_FLOW_NODE_STARTED,
    EVENT_RUN_CANCELLED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
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
    parse_model_id,
    run_graph_chat_runtime,
    update_chat_model_selection,
    _build_trigger_payload,
    FlowRunHandle,
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
from nodes._types import NodeEvent

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


def ensure_chat_initialized(chat_id: Optional[str], model_id: Optional[str]) -> str:
    agent_ref: str | None = None
    if model_id and model_id.startswith("agent:"):
        agent_ref = model_id[len("agent:") :]
    effective_model_id = None if agent_ref else model_id

    if not chat_id:
        chat_id = str(uuid.uuid4())
        with db.db_session() as sess:
            now = datetime.now(UTC).isoformat()
            db.create_chat(
                sess,
                id=chat_id,
                title="New Chat",
                model=effective_model_id,
                createdAt=now,
                updatedAt=now,
            )
            provider, model = parse_model_id(effective_model_id)
            config = {
                "provider": provider,
                "model_id": model,
                "tool_ids": db.get_default_tool_ids(sess),
                "instructions": [],
            }
            if agent_ref:
                config["agent_id"] = agent_ref
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
        return chat_id

    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            provider, model = parse_model_id(effective_model_id)
            config = {
                "provider": provider,
                "model_id": model,
                "tool_ids": db.get_default_tool_ids(sess),
                "instructions": [],
            }
            if agent_ref:
                config["agent_id"] = agent_ref
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
        elif model_id:
            update_chat_model_selection(sess, chat_id, model_id)

    return chat_id


def save_user_msg(
    msg: ChatMessage,
    chat_id: str,
    parent_id: Optional[str] = None,
    attachments: Optional[List[Attachment]] = None,
    manifest_id: Optional[str] = None,
):
    with db.db_session() as sess:
        now = datetime.now(UTC).isoformat()
        message = db.Message(
            id=msg.id,
            chatId=chat_id,
            role=msg.role,
            content=msg.content,
            createdAt=msg.createdAt or now,
            parent_message_id=parent_id,
            is_complete=True,
            sequence=db.get_next_sibling_sequence(sess, parent_id, chat_id),
            attachments=json.dumps([att.model_dump() for att in attachments])
            if attachments
            else None,
            manifest_id=manifest_id,
        )
        sess.add(message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, msg.id)
        db.update_chat(sess, id=chat_id, updatedAt=now)


def init_assistant_msg(chat_id: str, parent_id: str) -> str:
    msg_id = str(uuid.uuid4())
    with db.db_session() as sess:
        now = datetime.now(UTC).isoformat()
        model_used = None
        try:
            config = db.get_chat_agent_config(sess, chat_id)
            if config:
                provider = config.get("provider") or ""
                model_id = config.get("model_id") or ""
                model_used = (
                    f"{provider}:{model_id}"
                    if provider and model_id
                    else (model_id or None)
                )
        except Exception:
            pass

        message = db.Message(
            id=msg_id,
            chatId=chat_id,
            role="assistant",
            content="",
            createdAt=now,
            parent_message_id=parent_id,
            is_complete=False,
            sequence=db.get_next_sibling_sequence(sess, parent_id, chat_id),
            model_used=model_used,
        )
        sess.add(message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, msg_id)
        db.update_chat(sess, id=chat_id, updatedAt=now)
    return msg_id


class CancelRunRequest(BaseModel):
    messageId: str


class RespondToToolApprovalInput(BaseModel):
    runId: str
    approved: bool
    toolDecisions: Optional[Dict[str, bool]] = None
    editedArgs: Optional[Dict[str, Dict[str, Any]]] = None


@command
async def respond_to_tool_approval(body: RespondToToolApprovalInput) -> dict:
    run_control.set_approval_response(
        body.runId,
        approved=body.approved,
        tool_decisions=body.toolDecisions or {},
        edited_args=body.editedArgs or {},
    )
    return {"success": True}


@command
async def cancel_run(body: CancelRunRequest) -> dict:
    active_run = run_control.get_active_run(body.messageId)
    if active_run is None:
        logger.info(
            f"[cancel_run] No active run found for message {body.messageId}; storing early intent"
        )
        run_control.mark_early_cancel(body.messageId)

        try:
            with db.db_session() as sess:
                db.mark_message_complete(sess, body.messageId)
        except Exception as e:
            logger.info(f"[cancel_run] Warning marking message complete: {e}")

        return {"cancelled": True}

    run_id, agent = active_run
    remove_active_run = False
    try:
        if run_id:
            logger.info(
                f"[cancel_run] Cancelling run {run_id} for message {body.messageId}"
            )
            agent.cancel_run(run_id)
            remove_active_run = True
        else:
            logger.info(
                f"[cancel_run] Flagging early cancel for message {body.messageId}"
            )
            run_control.mark_early_cancel(body.messageId)
            request_cancel = getattr(agent, "request_cancel", None)
            if callable(request_cancel):
                request_cancel()

        with db.db_session() as sess:
            db.mark_message_complete(sess, body.messageId)
        if remove_active_run:
            run_control.remove_active_run(body.messageId)
        logger.info(f"[cancel_run] Successfully cancelled for message {body.messageId}")
        return {"cancelled": True}
    except Exception as e:
        logger.info(f"[cancel_run] Error cancelling run: {e}")
        return {"cancelled": False}


@command
async def cancel_flow_run(body: CancelFlowRunRequest) -> dict:
    active_run = run_control.get_active_run(body.runId)
    if active_run is None:
        logger.info(
            f"[cancel_flow_run] No active run found for flow run {body.runId}"
        )
        return {"cancelled": False}

    run_id, agent = active_run
    remove_active_run = False
    try:
        if run_id:
            logger.info(
                f"[cancel_flow_run] Cancelling run {run_id} for flow run {body.runId}"
            )
            agent.cancel_run(run_id)
            remove_active_run = True
        else:
            logger.info(
                f"[cancel_flow_run] Flagging early cancel for flow run {body.runId}"
            )
            run_control.mark_early_cancel(body.runId)
            request_cancel = getattr(agent, "request_cancel", None)
            if callable(request_cancel):
                request_cancel()

        if remove_active_run:
            run_control.remove_active_run(body.runId)
        logger.info(f"[cancel_flow_run] Successfully cancelled for flow run {body.runId}")
        return {"cancelled": True}
    except Exception as e:
        logger.info(f"[cancel_flow_run] Error cancelling run: {e}")
        return {"cancelled": False}


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

    validated_model_options: Dict[str, Any] = {}

    if body.modelId:
        validated_model_options = validate_model_options(
            body.chatId, body.modelId, body.modelOptions, channel
        )
        if validated_model_options is None:
            return

    chat_id = ensure_chat_initialized(body.chatId, body.modelId)

    if not body.modelId:
        result = validate_model_options(chat_id, None, body.modelOptions, channel)
        if result is None:
            return
        validated_model_options = result

    saved_attachments = []
    manifest_id = None
    file_renames = {}

    if body.attachments:
        attachment_state = prepare_stream_attachments(
            chat_id,
            body.attachments,
            source_ref=messages[-1].id if messages else None,
        )
        saved_attachments = attachment_state.attachments
        manifest_id = attachment_state.manifest_id
        file_renames = attachment_state.file_renames

    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_id = chat.active_leaf_message_id if chat else None

    if messages and messages[-1].role == "user":
        if saved_attachments:
            messages[-1].attachments = saved_attachments
        save_user_msg(
            messages[-1],
            chat_id,
            parent_id,
            attachments=saved_attachments or None,
            manifest_id=manifest_id,
        )
        parent_id = messages[-1].id

    emit_chat_event(
        channel,
        EVENT_RUN_STARTED,
        sessionId=chat_id,
        fileRenames=file_renames,
    )

    assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    emit_chat_event(channel, EVENT_ASSISTANT_MESSAGE_ID, content=assistant_msg_id)

    try:
        graph_data = get_graph_data_for_chat(
            chat_id,
            body.modelId,
            model_options=validated_model_options,
        )
        logger.info("[stream] Unified chat runtime — running graph runtime")
        await run_graph_chat_runtime(
            graph_data,
            messages,
            assistant_msg_id,
            channel,
            chat_id=chat_id,
            ephemeral=False,
            extra_tool_ids=body.toolIds or None,
        )
        return
    except Exception as e:
        await handle_streaming_run_error(
            assistant_msg_id, e, channel,
            chat_id=chat_id, label="[stream]",
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


class FlowRunCancelHandle:
    def __init__(self, run_handle: FlowRunHandle, execution_ctx: Any | None) -> None:
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

    agent_manager = get_agent_manager()
    agent_data = agent_manager.get_agent(body.agentId)
    if not agent_data:
        emit_chat_event(
            channel,
            EVENT_RUN_ERROR,
            content=f"Agent '{body.agentId}' not found",
        )
        return

    ephemeral = body.ephemeral

    if ephemeral:
        chat_id = ""
        assistant_msg_id = str(uuid.uuid4())
    else:
        chat_id = ensure_chat_initialized(body.chatId, None)
        with db.db_session() as sess:
            chat = sess.get(db.Chat, chat_id)
            parent_id = chat.active_leaf_message_id if chat else None
        if messages and messages[-1].role == "user":
            save_user_msg(messages[-1], chat_id, parent_id)
            parent_id = messages[-1].id
        assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    emit_run_start_events(channel, chat_id, assistant_msg_id)

    try:
        graph_data = agent_data["graph_data"]
        logger.info("[stream_agent] Graph-backed chat — running graph runtime")
        await run_graph_chat_runtime(
            graph_data,
            messages,
            assistant_msg_id,
            channel,
            chat_id=chat_id,
            ephemeral=ephemeral,
            agent_id=body.agentId,
        )
    except Exception as e:
        await handle_streaming_run_error(
            assistant_msg_id, e, channel,
            chat_id=chat_id, ephemeral=ephemeral, label="[stream_agent]",
        )


@command
async def stream_flow_run(
    channel: Channel,
    body: StreamFlowRunRequest,
) -> None:
    agent_manager = get_agent_manager()
    agent_data = agent_manager.get_agent(body.agentId)
    if not agent_data:
        emit_chat_event(
            channel,
            EVENT_RUN_ERROR,
            content=f"Agent '{body.agentId}' not found",
        )
        return

    prompt = body.promptInput or FlowRunPromptInput()
    message = prompt.message or ""
    history = prompt.history or []
    messages = prompt.messages or []
    attachments = prompt.attachments or []

    trigger_payload = _build_trigger_payload(
        message,
        history,
        attachments,
        messages,
    )

    run_id = str(uuid.uuid4())
    scope_payload: dict[str, Any] = {
        "mode": body.mode,
        "target_node_ids": [body.targetNodeId],
    }
    if body.nodeIds is not None:
        scope_payload["node_ids"] = body.nodeIds

    execution_ctx = types.SimpleNamespace(
        scope=scope_payload,
        cached_outputs=body.cachedOutputs or {},
        stop_run=False,
    )
    run_handle = FlowRunHandle()
    cancel_handle = FlowRunCancelHandle(run_handle, execution_ctx)

    services = types.SimpleNamespace(
        run_handle=cancel_handle,
        extra_tool_ids=[],
        tool_registry=get_tool_registry(),
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

    run_control.register_active_run(run_id, cancel_handle)

    emit_chat_event(channel, EVENT_RUN_STARTED, sessionId=run_id)

    try:
        if run_control.consume_early_cancel(run_id):
            emit_chat_event(channel, EVENT_RUN_CANCELLED)
            return

        async for item in run_flow(agent_data["graph_data"], context):
            if isinstance(item, NodeEvent):
                if item.event_type == "agent_event":
                    payload = dict(item.data or {})
                    event_name = str(payload.pop("event", "agent_event"))
                    emit_chat_event(
                        channel,
                        event_name,
                        allow_unknown=True,
                        **payload,
                    )
                    continue

                if item.event_type == "progress":
                    token = (item.data or {}).get("token", "")
                    if token:
                        emit_chat_event(channel, EVENT_RUN_CONTENT, content=token)
                    continue

                if item.event_type == "cancelled":
                    emit_chat_event(channel, EVENT_RUN_CANCELLED)
                    return

                if item.event_type == "started":
                    emit_chat_event(
                        channel,
                        EVENT_FLOW_NODE_STARTED,
                        nodeId=item.node_id,
                        nodeType=item.node_type,
                    )
                    continue

                if item.event_type == "completed":
                    emit_chat_event(
                        channel,
                        EVENT_FLOW_NODE_COMPLETED,
                        nodeId=item.node_id,
                        nodeType=item.node_type,
                    )
                    continue

                if item.event_type == "result":
                    emit_chat_event(
                        channel,
                        EVENT_FLOW_NODE_RESULT,
                        nodeId=item.node_id,
                        nodeType=item.node_type,
                        outputs=(item.data or {}).get("outputs", {}),
                    )
                    continue

                if item.event_type == "error":
                    emit_chat_event(
                        channel,
                        EVENT_FLOW_NODE_ERROR,
                        nodeId=item.node_id,
                        nodeType=item.node_type,
                        error=(item.data or {}).get("error", "Unknown node error"),
                    )
                    emit_chat_event(channel, EVENT_RUN_ERROR, content="Node error")
                    return
        if cancel_handle.is_cancel_requested() or execution_ctx.stop_run:
            emit_chat_event(channel, EVENT_RUN_CANCELLED)
        else:
            emit_chat_event(channel, EVENT_RUN_COMPLETED)
    except Exception as e:
        logger.error(f"[stream_flow_run] Error: {e}")
        emit_chat_event(channel, EVENT_RUN_ERROR, content=str(e))
    finally:
        run_control.remove_active_run(run_id)
        run_control.clear_early_cancel(run_id)


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
