from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from zynk import Channel, command

from .. import db
from ..models.chat import Attachment, ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from ..services.file_storage import (
    get_extension_from_mime,
    get_pending_attachment_path,
)
from ..services.workspace_manager import get_workspace_manager
from .streaming import (
    handle_content_stream,
    parse_model_id,
)

logger = logging.getLogger(__name__)


class ContinueMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None
    toolIds: List[str] = []


class RetryMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None
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


@command
async def continue_message(
    channel: Channel,
    body: ContinueMessageRequest,
) -> None:
    """Continue incomplete assistant message by creating a sibling branch."""
    existing_blocks: List[Dict[str, Any]] = []
    original_msg_id: Optional[str] = None

    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)

        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            channel.send_model(ChatEvent(event="RunError", content="Message not found"))
            return

        messages = (
            db.get_message_path(sess, original_msg.parent_message_id)
            if original_msg.parent_message_id
            else []
        )

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass

            attachments = None
            if m.role == "user" and m.attachments:
                try:
                    attachments_data = json.loads(m.attachments)
                    attachments = [
                        Attachment(**att_data) for att_data in attachments_data
                    ]
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                    attachments=attachments,
                )
            )

        if original_msg.content and isinstance(original_msg.content, str):
            raw = original_msg.content.strip()
            if raw.startswith("["):
                try:
                    existing_blocks = json.loads(raw)
                except Exception:
                    existing_blocks = [
                        {"type": "text", "content": original_msg.content}
                    ]
            else:
                existing_blocks = [{"type": "text", "content": original_msg.content}]
            while (
                existing_blocks
                and isinstance(existing_blocks[-1], dict)
                and existing_blocks[-1].get("type") == "error"
            ):
                existing_blocks.pop()

        new_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="assistant",
            content=json.dumps(existing_blocks) if existing_blocks else "",
            chat_id=body.chatId,
            is_complete=False,
        )

        db.set_active_leaf(sess, body.chatId, new_msg_id)
        original_msg_id = original_msg.id

    db.materialize_to_branch(body.chatId, original_msg_id)

    channel.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    channel.send_model(
        ChatEvent(
            event="AssistantMessageId",
            content=new_msg_id,
            blocks=existing_blocks if existing_blocks else None,
        )
    )

    try:
        agent = create_agent_for_chat(
            body.chatId,
            tool_ids=body.toolIds,
        )

        await handle_content_stream(
            agent,
            chat_messages,
            new_msg_id,
            channel,
            chat_id=body.chatId,
        )

    except Exception as e:
        logger.error(f"[continue_message] Error: {e}")
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, new_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith("["):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(
                    {
                        "type": "error",
                        "content": str(e),
                    }
                )
                db.update_message_content(
                    sess, messageId=new_msg_id, content=json.dumps(blocks)
                )
        except Exception:
            pass
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


@command
async def retry_message(
    channel: Channel,
    body: RetryMessageRequest,
) -> None:
    parent_msg_id: Optional[str] = None
    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            channel.send_model(ChatEvent(event="RunError", content="Message not found"))
            return

        messages = (
            db.get_message_path(sess, original_msg.parent_message_id)
            if original_msg.parent_message_id
            else []
        )

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass

            attachments = None
            if m.role == "user" and m.attachments:
                try:
                    attachments_data = json.loads(m.attachments)
                    attachments = [
                        Attachment(**att_data) for att_data in attachments_data
                    ]
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                    attachments=attachments,
                )
            )

        new_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )

        db.set_active_leaf(sess, body.chatId, new_msg_id)
        parent_msg_id = original_msg.parent_message_id

    if parent_msg_id:
        db.materialize_to_branch(body.chatId, parent_msg_id)

    channel.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    channel.send_model(ChatEvent(event="AssistantMessageId", content=new_msg_id))

    try:
        agent = create_agent_for_chat(
            body.chatId,
            tool_ids=body.toolIds,
        )

        await handle_content_stream(
            agent,
            chat_messages,
            new_msg_id,
            channel,
            chat_id=body.chatId,
        )

    except Exception as e:
        logger.error(f"[retry_message] Error: {e}")
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, new_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith("["):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(
                    {
                        "type": "error",
                        "content": str(e),
                    }
                )
                db.update_message_content(
                    sess, messageId=new_msg_id, content=json.dumps(blocks)
                )
        except Exception:
            pass
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


@command
async def edit_user_message(
    channel: Channel,
    body: EditUserMessageRequest,
) -> None:
    """Edit user message by creating sibling with new content."""
    file_renames: Dict[str, str] = {}
    manifest_id: Optional[str] = None

    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            channel.send_model(ChatEvent(event="RunError", content="Message not found"))
            return

        messages = (
            db.get_message_path(sess, original_msg.parent_message_id)
            if original_msg.parent_message_id
            else []
        )
        original_manifest_id = db.get_manifest_for_message(sess, original_msg.id)

        all_attachments: List[Attachment] = []

        files_to_add: List[tuple[str, bytes]] = []

        for existing_att in body.existingAttachments:
            content = None
            if original_manifest_id:
                workspace_manager = get_workspace_manager(body.chatId)
                content = workspace_manager.read_file_from_manifest(
                    original_manifest_id, existing_att.name
                )

            if content:
                files_to_add.append((existing_att.name, content))
                all_attachments.append(
                    Attachment(
                        id=existing_att.id,
                        type=existing_att.type,
                        name=existing_att.name,
                        mimeType=existing_att.mimeType,
                        size=existing_att.size,
                    )
                )
            else:
                logger.warning(
                    f"[edit_user_message] Could not find existing attachment "
                    f"'{existing_att.name}' in manifest {original_manifest_id}"
                )

        for new_att in body.newAttachments:
            extension = get_extension_from_mime(new_att.mimeType)
            pending_path = get_pending_attachment_path(new_att.id, extension)

            if pending_path.exists():
                content = pending_path.read_bytes()
                files_to_add.append((new_att.name, content))
                pending_path.unlink()
            elif new_att.data:
                import base64

                content = base64.b64decode(new_att.data)
                files_to_add.append((new_att.name, content))

            all_attachments.append(
                Attachment(
                    id=new_att.id,
                    type=new_att.type,
                    name=new_att.name,
                    mimeType=new_att.mimeType,
                    size=new_att.size,
                )
            )

        if files_to_add:
            workspace_manager = get_workspace_manager(body.chatId)
            manifest_id, file_renames = workspace_manager.add_files(
                files=files_to_add,
                parent_manifest_id=None,
                source="user_upload",
                source_ref=None,
            )

            for att in all_attachments:
                if att.name in file_renames:
                    att.name = file_renames[att.name]

        new_user_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="user",
            content=body.newContent,
            chat_id=body.chatId,
            is_complete=True,
        )

        if all_attachments:
            attachments_json = json.dumps([att.model_dump() for att in all_attachments])
            user_msg = sess.get(db.Message, new_user_msg_id)
            if user_msg:
                user_msg.attachments = attachments_json
                if manifest_id:
                    user_msg.manifest_id = manifest_id
                sess.commit()
        elif manifest_id:
            user_msg = sess.get(db.Message, new_user_msg_id)
            if user_msg:
                user_msg.manifest_id = manifest_id
                sess.commit()

        db.set_active_leaf(sess, body.chatId, new_user_msg_id)

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass

            msg_attachments = None
            if m.role == "user" and m.attachments:
                try:
                    attachments_data = json.loads(m.attachments)
                    msg_attachments = [
                        Attachment(**att_data) for att_data in attachments_data
                    ]
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                    attachments=msg_attachments,
                )
            )

        chat_messages.append(
            ChatMessage(
                id=new_user_msg_id,
                role="user",
                content=body.newContent,
                createdAt=original_msg.createdAt,
                attachments=all_attachments if all_attachments else None,
            )
        )

        assistant_msg_id = db.create_branch_message(
            sess,
            parent_id=new_user_msg_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )

        db.set_active_leaf(sess, body.chatId, assistant_msg_id)

    db.materialize_to_branch(body.chatId, new_user_msg_id)

    channel.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    channel.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))

    try:
        agent = create_agent_for_chat(
            body.chatId,
            tool_ids=body.toolIds,
        )

        await handle_content_stream(
            agent,
            chat_messages,
            assistant_msg_id,
            channel,
            chat_id=body.chatId,
        )

    except Exception as e:
        logger.error(f"[edit_user_message] Error: {e}")
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, assistant_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith("["):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(
                    {
                        "type": "error",
                        "content": str(e),
                    }
                )
                db.update_message_content(
                    sess, messageId=assistant_msg_id, content=json.dumps(blocks)
                )
        except Exception:
            pass
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


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
