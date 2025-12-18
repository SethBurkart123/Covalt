from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import sqlalchemy
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Chat, Message


def list_chats(sess: Session) -> List[Chat]:
    stmt = select(Chat).order_by(
        Chat.updatedAt.desc().nulls_last(), Chat.createdAt.desc().nulls_last()
    )
    return list(sess.scalars(stmt))


def get_chat_messages(sess: Session, chatId: str) -> List[Dict[str, Any]]:
    """Get messages for the active branch of a chat."""
    # Get the chat to find active leaf
    chat = sess.get(Chat, chatId)
    if not chat or not chat.active_leaf_message_id:
        # Fallback: return all messages in creation order (for old chats)
        stmt = (
            select(Message)
            .where(Message.chatId == chatId)
            .order_by(Message.createdAt.asc().nulls_last())
        )
        rows = list(sess.scalars(stmt))
    else:
        # Use the active branch path
        rows = get_message_path(sess, chat.active_leaf_message_id)

    messages: List[Dict[str, Any]] = []
    for r in rows:
        toolCalls = json.loads(r.toolCalls) if r.toolCalls else None

        # Parse content if it's a JSON array (structured content blocks)
        content = r.content
        if content and content.strip().startswith("["):
            try:
                content = json.loads(content)
            except Exception:
                # If parsing fails, keep as string (legacy format)
                pass

        messages.append(
            {
                "id": r.id,
                "role": r.role,
                "content": content,
                "createdAt": r.createdAt,
                "toolCalls": toolCalls,
                "parentMessageId": r.parent_message_id,
                "isComplete": r.is_complete,
                "sequence": r.sequence,
                "modelUsed": r.model_used,
            }
        )
    return messages


def create_chat(
    sess: Session,
    *,
    id: str,
    title: str,
    model: Optional[str],
    createdAt: str,
    updatedAt: str,
) -> None:
    chat = Chat(
        id=id,
        title=title,
        model=model,
        createdAt=createdAt,
        updatedAt=updatedAt,
    )
    sess.add(chat)
    sess.commit()


def update_chat(
    sess: Session,
    *,
    id: str,
    title: Optional[str] = None,
    model: Optional[str] = None,
    updatedAt: Optional[str] = None,
) -> None:
    chat: Optional[Chat] = sess.get(Chat, id)
    if not chat:
        return
    if title is not None:
        chat.title = title
    if model is not None:
        chat.model = model
    if updatedAt is not None:
        chat.updatedAt = updatedAt
    sess.commit()


def delete_chat(sess: Session, *, chatId: str) -> None:
    chat = sess.get(Chat, chatId)
    if chat:
        sess.delete(chat)
        sess.commit()


def append_message(
    sess: Session,
    *,
    id: str,
    chatId: str,
    role: str,
    content: str,
    createdAt: str,
    toolCalls: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Append a new message to a chat."""
    sess.add(
        Message(
            id=id,
            chatId=chatId,
            role=role,
            content=content,
            createdAt=createdAt,
            toolCalls=json.dumps(toolCalls) if toolCalls is not None else None,
        )
    )
    sess.commit()


def update_message_content(
    sess: Session,
    *,
    messageId: str,
    content: str,
    toolCalls: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Update the content of an existing message (for streaming updates)."""
    message: Optional[Message] = sess.get(Message, messageId)
    if not message:
        return
    message.content = content
    if toolCalls is not None:
        message.toolCalls = json.dumps(toolCalls)
    sess.commit()


def get_message_path(sess: Session, leaf_id: str) -> List[Message]:
    """Walk up from leaf to root, return ordered list (root first)."""
    path = []
    current_id = leaf_id

    while current_id:
        message = sess.get(Message, current_id)
        if not message:
            break
        path.append(message)
        current_id = message.parent_message_id

    # Reverse to get root-to-leaf order
    return list(reversed(path))


def get_message_children(
    sess: Session, parent_id: Optional[str], chat_id: str
) -> List[Message]:
    """Get all child messages of a parent within a specific chat, ordered by sequence."""
    stmt = (
        select(Message)
        .where(Message.parent_message_id == parent_id)
        .where(Message.chatId == chat_id)
        .order_by(Message.sequence.asc())
    )
    return list(sess.scalars(stmt))


def get_next_sibling_sequence(
    sess: Session, parent_id: Optional[str], chat_id: str
) -> int:
    """Get next sequence number for siblings with same parent in the same chat."""
    stmt = (
        select(sqlalchemy.func.max(Message.sequence))
        .where(Message.parent_message_id == parent_id)
        .where(Message.chatId == chat_id)
    )
    max_seq = sess.scalar(stmt)
    return (max_seq or 0) + 1


def set_active_leaf(sess: Session, chat_id: str, leaf_id: str) -> None:
    """Update active_leaf_message_id for a chat."""
    chat = sess.get(Chat, chat_id)
    if chat:
        chat.active_leaf_message_id = leaf_id
        sess.commit()


def create_branch_message(
    sess: Session,
    *,
    parent_id: Optional[str],
    role: str,
    content: str,
    chat_id: str,
    is_complete: bool = False,
) -> str:
    """Create a new message in the tree and return its ID."""
    message_id = str(uuid.uuid4())
    sequence = get_next_sibling_sequence(sess, parent_id, chat_id)

    # Determine model used for assistant messages from chat agent config
    model_used: Optional[str] = None
    if role == "assistant":
        try:
            config = get_chat_agent_config(sess, chat_id)
            if config:
                provider = config.get("provider") or ""
                model_id = config.get("model_id") or ""
                if provider and model_id:
                    model_used = f"{provider}:{model_id}"
                else:
                    model_used = model_id or None
        except Exception:
            model_used = None

    message = Message(
        id=message_id,
        chatId=chat_id,
        role=role,
        content=content,
        parent_message_id=parent_id,
        is_complete=is_complete,
        sequence=sequence,
        createdAt=datetime.utcnow().isoformat(),
        model_used=model_used,
    )
    sess.add(message)
    sess.commit()

    return message_id


def mark_message_complete(sess: Session, message_id: str) -> None:
    """Mark a message as complete."""
    message = sess.get(Message, message_id)
    if message:
        message.is_complete = True
        sess.commit()


def get_leaf_descendant(sess: Session, message_id: str, chat_id: str) -> str:
    """Get the leaf descendant of a message (for branch switching).

    If message has children, follow the last child down to a leaf.
    Otherwise, return the message itself.
    """
    current_id = message_id

    while True:
        children = get_message_children(sess, current_id, chat_id)
        if not children:
            return current_id
        # Follow last child
        current_id = children[-1].id


def get_chat_agent_config(sess: Session, chatId: str) -> Optional[Dict[str, Any]]:
    """
    Get agent configuration for a chat.

    Returns:
        Agent config dict or None if not set
    """
    chat: Optional[Chat] = sess.get(Chat, chatId)
    if not chat or not chat.agent_config:
        return None

    try:
        return json.loads(chat.agent_config)
    except Exception:
        return None


def update_chat_agent_config(
    sess: Session,
    *,
    chatId: str,
    config: Dict[str, Any],
) -> None:
    """
    Update agent configuration for a chat.

    Args:
        sess: Database session
        chatId: Chat identifier
        config: Agent configuration dict (provider, model_id, tool_ids, etc.)
    """
    chat: Optional[Chat] = sess.get(Chat, chatId)
    if not chat:
        return

    chat.agent_config = json.dumps(config)
    sess.commit()


def get_default_agent_config() -> Dict[str, Any]:
    """
    Get default agent configuration for new chats.

    Returns:
        Default config with openai provider and no tools
    """
    return {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "tool_ids": [],
        "instructions": [],
    }
