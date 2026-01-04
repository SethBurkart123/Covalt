from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from zynk import Channel, command

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from .streaming import handle_content_stream, parse_model_id


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


class EditUserMessageRequest(BaseModel):
    messageId: str
    newContent: str
    chatId: str
    modelId: Optional[str] = None
    toolIds: List[str] = []


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

        # Get message path up to (but not including) the original message
        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass
            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                )
            )

        # Extract existing content (strip error blocks)
        if original_msg.content and isinstance(original_msg.content, str):
            raw = original_msg.content.strip()
            if raw.startswith("["):
                try:
                    existing_blocks = json.loads(raw)
                except Exception:
                    existing_blocks = [{"type": "text", "content": original_msg.content}]
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

    channel.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    channel.send_model(ChatEvent(
        event="AssistantMessageId",
        content=new_msg_id,
        blocks=existing_blocks if existing_blocks else None,
    ))

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
        print(f"[continue_message] Error: {e}")
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
    """Create sibling message and retry generation."""
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

        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass
            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
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
        print(f"[retry_message] Error: {e}")
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

        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []

        new_user_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="user",
            content=body.newContent,
            chat_id=body.chatId,
            is_complete=True,
        )

        db.set_active_leaf(sess, body.chatId, new_user_msg_id)

        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith("["):
                try:
                    content = json.loads(content)
                except Exception:
                    pass
            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                )
            )
        chat_messages.append(
            ChatMessage(
                id=new_user_msg_id,
                role="user",
                content=body.newContent,
                createdAt=original_msg.createdAt,
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
        print(f"[edit_user_message] Error: {e}")
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
    """Switch active branch to different sibling."""
    with db.db_session() as sess:
        leaf_id = db.get_leaf_descendant(sess, body.siblingId, body.chatId)
        db.set_active_leaf(sess, body.chatId, leaf_id)


@command
async def get_message_siblings(
    body: GetMessageSiblingsRequest,
) -> List[MessageSiblingInfo]:
    """Get all sibling messages for navigation UI."""
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
