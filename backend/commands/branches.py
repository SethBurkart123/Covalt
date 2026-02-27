from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from sqlalchemy import or_, select

from zynk import Channel, command

from ..application.conversation import (
    ContinueRunDependencies,
    ContinueRunInput,
    EditUserMessageRunDependencies,
    EditUserMessageRunInput,
    ExistingAttachmentInput as ExistingAttachmentInputDTO,
    NewAttachmentInput as NewAttachmentInputDTO,
    RetryRunDependencies,
    RetryRunInput,
    execute_continue_run,
    execute_edit_user_message_run,
    execute_retry_run,
)
from .. import db
from ..models.chat import Attachment, ChatMessage
from ..services.runtime_events import EVENT_RUN_ERROR, emit_chat_event
from ..services.file_storage import (
    get_extension_from_mime,
    get_pending_attachment_path,
)
from ..services.chat_graph_runner import (
    append_error_block_to_message,
    get_graph_data_for_chat,
    run_graph_chat_runtime,
    update_chat_model_selection,
)
from ..services.workspace_manager import get_workspace_manager
from ..services.conversation_run_service import (
    validate_model_options,
    build_message_history,
    emit_run_start_events,
)

logger = logging.getLogger(__name__)


class ContinueMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None
    modelOptions: Optional[Dict[str, Any]] = None
    toolIds: List[str] = []


class RetryMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None
    modelOptions: Optional[Dict[str, Any]] = None
    toolIds: List[str] = []


class AttachmentInput(BaseModel):
    id: str
    type: str
    name: str
    mimeType: str
    size: int
    data: str


class ExistingAttachmentInput(BaseModel):
    id: str
    type: str
    name: str
    mimeType: str
    size: int


class EditUserMessageRequest(BaseModel):
    messageId: str
    newContent: str
    chatId: str
    modelId: Optional[str] = None
    modelOptions: Optional[Dict[str, Any]] = None
    toolIds: List[str] = []
    existingAttachments: List[ExistingAttachmentInput] = []
    newAttachments: List[AttachmentInput] = []


class SwitchToSiblingRequest(BaseModel):
    messageId: str
    siblingId: str
    chatId: str


class GetMessageSiblingsRequest(BaseModel):
    messageId: str


class MessageSiblingInfo(BaseModel):
    id: str
    sequence: int
    isActive: bool


class GetMessageSiblingsBatchRequest(BaseModel):
    chatId: str
    messageIds: List[str]


def _get_original_message(sess: Any, message_id: str) -> Any:
    return sess.get(db.Message, message_id)


def _create_branch_message(
    sess: Any,
    parent_id: Optional[str],
    role: str,
    content: str,
    chat_id: str,
    is_complete: bool,
) -> str:
    return db.create_branch_message(
        sess,
        parent_id=parent_id,
        role=role,
        content=content,
        chat_id=chat_id,
        is_complete=is_complete,
    )


def _emit_continue_run_start_events(
    channel: Channel,
    chat_id: str,
    message_id: str,
    blocks: Optional[List[Dict[str, Any]]],
) -> None:
    emit_run_start_events(channel, chat_id, message_id, blocks=blocks)


def _emit_branch_run_error(channel: Channel, content: str) -> None:
    emit_chat_event(channel, EVENT_RUN_ERROR, content=content)


def _get_graph_data(chat_id: str, model_id: Optional[str], model_options: Dict[str, Any]) -> Dict[str, Any]:
    return get_graph_data_for_chat(
        chat_id,
        model_id,
        model_options=model_options,
    )


def _append_error_block(message_id: str, error_message: str) -> None:
    append_error_block_to_message(
        message_id,
        error_message=error_message,
    )


def _build_continue_run_dependencies() -> ContinueRunDependencies:
    return ContinueRunDependencies(
        validate_model_options=validate_model_options,
        update_chat_model_selection=update_chat_model_selection,
        get_session=db.db_session,
        get_original_message=_get_original_message,
        get_message_path=db.get_message_path,
        build_message_history=build_message_history,
        create_branch_message=_create_branch_message,
        set_active_leaf=db.set_active_leaf,
        materialize_to_branch=db.materialize_to_branch,
        emit_run_start_events=_emit_continue_run_start_events,
        get_graph_data_for_chat=_get_graph_data,
        run_graph_chat_runtime=run_graph_chat_runtime,
        append_error_block_to_message=_append_error_block,
        emit_run_error=_emit_branch_run_error,
        logger=logger,
    )


@command
async def continue_message(
    channel: Channel,
    body: ContinueMessageRequest,
) -> None:
    await execute_continue_run(
        ContinueRunInput(
            channel=channel,
            chat_id=body.chatId,
            message_id=body.messageId,
            model_id=body.modelId,
            model_options=body.modelOptions,
            tool_ids=body.toolIds,
        ),
        _build_continue_run_dependencies(),
    )


def _emit_retry_run_start_events(
    channel: Channel,
    chat_id: str,
    message_id: str,
) -> None:
    emit_run_start_events(channel, chat_id, message_id)


def _build_retry_run_dependencies() -> RetryRunDependencies:
    return RetryRunDependencies(
        validate_model_options=validate_model_options,
        update_chat_model_selection=update_chat_model_selection,
        get_session=db.db_session,
        get_original_message=_get_original_message,
        get_message_path=db.get_message_path,
        build_message_history=build_message_history,
        create_branch_message=_create_branch_message,
        set_active_leaf=db.set_active_leaf,
        materialize_to_branch=db.materialize_to_branch,
        emit_run_start_events=_emit_retry_run_start_events,
        get_graph_data_for_chat=_get_graph_data,
        run_graph_chat_runtime=run_graph_chat_runtime,
        append_error_block_to_message=_append_error_block,
        emit_run_error=_emit_branch_run_error,
        logger=logger,
    )


@command
async def retry_message(
    channel: Channel,
    body: RetryMessageRequest,
) -> None:
    await execute_retry_run(
        RetryRunInput(
            channel=channel,
            chat_id=body.chatId,
            message_id=body.messageId,
            model_id=body.modelId,
            model_options=body.modelOptions,
            tool_ids=body.toolIds,
        ),
        _build_retry_run_dependencies(),
    )


def _create_attachment(
    attachment_id: str,
    attachment_type: str,
    name: str,
    mime_type: str,
    size: int,
) -> Attachment:
    return Attachment(
        id=attachment_id,
        type=attachment_type,
        name=name,
        mimeType=mime_type,
        size=size,
    )


def _update_message_attachments_and_manifest(
    sess: Any,
    message_id: str,
    attachments_json: Optional[str],
    manifest_id: Optional[str],
) -> None:
    user_msg = sess.get(db.Message, message_id)
    if not user_msg:
        return

    if attachments_json:
        user_msg.attachments = attachments_json
    if manifest_id:
        user_msg.manifest_id = manifest_id
    sess.commit()


def _create_chat_message(
    message_id: str,
    role: str,
    content: str,
    created_at: str,
    attachments: Optional[List[Attachment]],
) -> ChatMessage:
    return ChatMessage(
        id=message_id,
        role=role,
        content=content,
        createdAt=created_at,
        attachments=attachments,
    )


def _emit_edit_run_start_events(channel: Channel, chat_id: str, message_id: str) -> None:
    emit_run_start_events(channel, chat_id, message_id)


def _build_edit_user_message_run_dependencies() -> EditUserMessageRunDependencies:
    return EditUserMessageRunDependencies(
        validate_model_options=validate_model_options,
        update_chat_model_selection=update_chat_model_selection,
        get_session=db.db_session,
        get_original_message=_get_original_message,
        get_manifest_for_message=db.get_manifest_for_message,
        get_workspace_manager=get_workspace_manager,
        get_extension_from_mime=get_extension_from_mime,
        get_pending_attachment_path=get_pending_attachment_path,
        create_attachment=_create_attachment,
        create_branch_message=_create_branch_message,
        update_message_attachments_and_manifest=_update_message_attachments_and_manifest,
        set_active_leaf=db.set_active_leaf,
        get_message_path=db.get_message_path,
        build_message_history=build_message_history,
        create_chat_message=_create_chat_message,
        materialize_to_branch=db.materialize_to_branch,
        emit_run_start_events=_emit_edit_run_start_events,
        get_graph_data_for_chat=_get_graph_data,
        run_graph_chat_runtime=run_graph_chat_runtime,
        append_error_block_to_message=_append_error_block,
        emit_run_error=_emit_branch_run_error,
        logger=logger,
    )


@command
async def edit_user_message(
    channel: Channel,
    body: EditUserMessageRequest,
) -> None:
    await execute_edit_user_message_run(
        EditUserMessageRunInput(
            channel=channel,
            chat_id=body.chatId,
            message_id=body.messageId,
            new_content=body.newContent,
            model_id=body.modelId,
            model_options=body.modelOptions,
            tool_ids=body.toolIds,
            existing_attachments=[
                ExistingAttachmentInputDTO(
                    id=attachment.id,
                    type=attachment.type,
                    name=attachment.name,
                    mimeType=attachment.mimeType,
                    size=attachment.size,
                )
                for attachment in body.existingAttachments
            ],
            new_attachments=[
                NewAttachmentInputDTO(
                    id=attachment.id,
                    type=attachment.type,
                    name=attachment.name,
                    mimeType=attachment.mimeType,
                    size=attachment.size,
                    data=attachment.data,
                )
                for attachment in body.newAttachments
            ],
        ),
        _build_edit_user_message_run_dependencies(),
    )


@command
async def switch_to_sibling(
    body: SwitchToSiblingRequest,
) -> None:
    with db.db_session() as sess:
        leaf_id = db.get_leaf_descendant(sess, body.siblingId, body.chatId)
        db.set_active_leaf(sess, body.chatId, leaf_id)

    db.materialize_to_branch(body.chatId, leaf_id)


@command
async def get_message_siblings(
    body: GetMessageSiblingsRequest,
) -> List[MessageSiblingInfo]:
    with db.db_session() as sess:
        message = sess.get(db.Message, body.messageId)
        if not message:
            return []

        siblings = db.get_message_children(
            sess, message.parent_message_id, message.chatId
        )

        chat = sess.get(db.Chat, message.chatId)
        active_path = []
        if chat and chat.active_leaf_message_id:
            active_path_msgs = db.get_message_path(sess, chat.active_leaf_message_id)
            active_path = [m.id for m in active_path_msgs]

        return [
            MessageSiblingInfo(
                id=sib.id,
                sequence=sib.sequence,
                isActive=sib.id in active_path,
            )
            for sib in siblings
        ]


@command
async def get_message_siblings_batch(
    body: GetMessageSiblingsBatchRequest,
) -> Dict[str, List[MessageSiblingInfo]]:
    message_ids = list(dict.fromkeys(body.messageIds))
    if not message_ids:
        return {}

    with db.db_session() as sess:
        stmt = (
            select(db.Message.id, db.Message.parent_message_id)
            .where(db.Message.chatId == body.chatId)
            .where(db.Message.id.in_(message_ids))
        )
        message_rows = list(sess.execute(stmt))
        if not message_rows:
            return {}

        parent_ids = {row[1] for row in message_rows}
        conditions = []
        if None in parent_ids:
            conditions.append(db.Message.parent_message_id.is_(None))
        non_null_parents = [pid for pid in parent_ids if pid is not None]
        if non_null_parents:
            conditions.append(db.Message.parent_message_id.in_(non_null_parents))

        siblings_by_parent: Dict[Optional[str], List[MessageSiblingInfo]] = {}
        active_path_ids: set[str] = set()

        chat = sess.get(db.Chat, body.chatId)
        if chat and chat.active_leaf_message_id:
            active_path_msgs = db.get_message_path(sess, chat.active_leaf_message_id)
            active_path_ids = {m.id for m in active_path_msgs}

        if conditions:
            sibling_stmt = (
                select(
                    db.Message.id,
                    db.Message.parent_message_id,
                    db.Message.sequence,
                )
                .where(db.Message.chatId == body.chatId)
                .where(or_(*conditions))
                .order_by(db.Message.sequence.asc())
            )
            siblings = list(sess.execute(sibling_stmt))
            for msg_id, parent_id, sequence in siblings:
                info = MessageSiblingInfo(
                    id=msg_id,
                    sequence=sequence,
                    isActive=msg_id in active_path_ids,
                )
                siblings_by_parent.setdefault(parent_id, []).append(info)

        return {
            msg_id: siblings_by_parent.get(parent_id, [])
            for msg_id, parent_id in message_rows
        }
