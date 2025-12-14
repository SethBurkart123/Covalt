from __future__ import annotations

import json
from typing import Dict, List, Any, Optional

from pydantic import BaseModel
from zynk import command, Channel

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from .streaming import handle_content_stream, parse_model_id


class ContinueMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None


class RetryMessageRequest(BaseModel):
    messageId: str
    chatId: str
    modelId: Optional[str] = None


class EditUserMessageRequest(BaseModel):
    messageId: str
    newContent: str
    chatId: str
    modelId: Optional[str] = None


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
    """Continue incomplete assistant message from where it stopped."""
    ch = channel
    
    existing_blocks: List[Dict[str, Any]] = []

    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            # Load existing config and merge model changes (preserve tools!)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)
        # Get the message path up to this message
        messages = db.get_message_path(sess, body.messageId)
        
        # Convert to ChatMessage format (parse JSON array content if present)
        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith('['):
                try:
                    content = json.loads(content)
                except Exception:
                    # Keep as-is if parsing fails (legacy/plain text)
                    pass
            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                )
            )

        # Seed blocks for the assistant message being continued (trim trailing error)
        target_msg = sess.get(db.Message, body.messageId)
        if target_msg and isinstance(target_msg.content, str):
            raw = target_msg.content.strip()
            if raw.startswith('['):
                try:
                    existing_blocks = json.loads(raw)
                except Exception:
                    existing_blocks = [{"type": "text", "content": target_msg.content}]
            else:
                existing_blocks = [{"type": "text", "content": target_msg.content}]
            # Remove trailing error blocks
            while existing_blocks and isinstance(existing_blocks[-1], dict) and existing_blocks[-1].get("type") == "error":
                existing_blocks.pop()
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    # For parity with other streams, emit the assistant message ID being continued
    ch.send_model(ChatEvent(event="AssistantMessageId", content=body.messageId))
    # Seed existing content so the frontend doesn't clear it on first chunk
    if existing_blocks:
        ch.send_model(ChatEvent(event="SeedBlocks", blocks=existing_blocks))
    
    try:
        agent = create_agent_for_chat(body.chatId, channel=ch, assistant_msg_id=body.messageId)
        
        # Continue streaming into the same message
        await handle_content_stream(
            agent,
            chat_messages,
            body.messageId,  # Same message ID - append content
            ch,
        )
        
    except Exception as e:
        print(f"[continue_message] Error: {e}")
        # Persist error to the message so reload shows it
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, body.messageId)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith('['):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append({
                    "type": "error",
                    "content": str(e),
                })
                db.update_message_content(sess, messageId=body.messageId, content=json.dumps(blocks))
        except Exception as _:
            pass
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@command
async def retry_message(
    channel: Channel,
    body: RetryMessageRequest,
) -> None:
    """Create sibling message and retry generation."""
    ch = channel
    
    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            # Load existing config and merge model changes (preserve tools!)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)
        # Get the original message to find its parent
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            ch.send_model(ChatEvent(event="RunError", content="Message not found"))
            return
        
        # Get conversation up to the parent
        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []
        
        # Convert to ChatMessage format (parse JSON array content if present)
        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith('['):
                try:
                    content = json.loads(content)
                except Exception:
                    # Keep as-is if parsing fails (legacy/plain text)
                    pass
            chat_messages.append(
                ChatMessage(
                    id=m.id,
                    role=m.role,
                    content=content,
                    createdAt=m.createdAt,
                )
            )
        
        # Create new sibling assistant message
        new_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )
        
        # Update active leaf to the new message
        db.set_active_leaf(sess, body.chatId, new_msg_id)
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    # Emit the assistant message ID so the frontend can track updates
    ch.send_model(ChatEvent(event="AssistantMessageId", content=new_msg_id))
    
    try:
        agent = create_agent_for_chat(body.chatId, channel=ch, assistant_msg_id=new_msg_id)
        
        # Stream fresh response
        await handle_content_stream(
            agent,
            chat_messages,
            new_msg_id,
            ch,
        )
        
    except Exception as e:
        print(f"[retry_message] Error: {e}")
        # Persist error to the new assistant message
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, new_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith('['):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append({
                    "type": "error",
                    "content": str(e),
                })
                db.update_message_content(sess, messageId=new_msg_id, content=json.dumps(blocks))
        except Exception as _:
            pass
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@command
async def edit_user_message(
    channel: Channel,
    body: EditUserMessageRequest,
) -> None:
    """Edit user message by creating sibling with new content."""
    ch = channel
    
    with db.db_session() as sess:
        if body.modelId:
            provider, model = parse_model_id(body.modelId)
            # Load existing config and merge model changes (preserve tools!)
            config = db.get_chat_agent_config(sess, body.chatId) or {}
            config["provider"] = provider
            config["model_id"] = model
            db.update_chat_agent_config(sess, chatId=body.chatId, config=config)
        # Get the original message to find its parent
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            ch.send_model(ChatEvent(event="RunError", content="Message not found"))
            return
        
        # Get conversation up to the parent (excluding the message being edited)
        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []
        
        # Create new sibling user message with edited content
        new_user_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="user",
            content=body.newContent,
            chat_id=body.chatId,
            is_complete=True,
        )
        
        # Update active leaf to the new user message
        db.set_active_leaf(sess, body.chatId, new_user_msg_id)
        
        # Convert to ChatMessage format (including the new user message)
        chat_messages = []
        for m in messages:
            content = m.content
            if isinstance(content, str) and content.strip().startswith('['):
                try:
                    content = json.loads(content)
                except Exception:
                    # Keep as-is if parsing fails (legacy/plain text)
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
        
        # Create assistant response message
        assistant_msg_id = db.create_branch_message(
            sess,
            parent_id=new_user_msg_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )
        
        # Update active leaf to the assistant message
        db.set_active_leaf(sess, body.chatId, assistant_msg_id)
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    # Emit the assistant message ID for frontend tracking
    ch.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))
    
    try:
        agent = create_agent_for_chat(body.chatId, channel=ch, assistant_msg_id=assistant_msg_id)
        
        # Stream response to edited message
        await handle_content_stream(
            agent,
            chat_messages,
            assistant_msg_id,
            ch,
        )
        
    except Exception as e:
        print(f"[edit_user_message] Error: {e}")
        # Persist error to the assistant message
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, assistant_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith('['):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append({
                    "type": "error",
                    "content": str(e),
                })
                db.update_message_content(sess, messageId=assistant_msg_id, content=json.dumps(blocks))
        except Exception as _:
            pass
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@command
async def switch_to_sibling(
    body: SwitchToSiblingRequest,
) -> None:
    """Switch active branch to different sibling."""
    with db.db_session() as sess:
        # Get the leaf descendant of the sibling
        leaf_id = db.get_leaf_descendant(sess, body.siblingId, body.chatId)

        # Update active leaf to point to this branch
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

        # Get all siblings (messages with same parent in the same chat)
        siblings = db.get_message_children(sess, message.parent_message_id, message.chatId)

        # Get the chat to determine which is active
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
