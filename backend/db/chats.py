from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import sqlalchemy
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Chat, Message
from ..models import decode_message_content


def list_chats(sess: Session) -> List[Chat]:
    stmt = select(Chat).order_by(
        Chat.updatedAt.desc().nulls_last(), Chat.createdAt.desc().nulls_last()
    )
    return list(sess.scalars(stmt))


def get_chat_messages(sess: Session, chatId: str) -> List[Dict[str, Any]]:
    chat = sess.get(Chat, chatId)
    if not chat or not chat.active_leaf_message_id:
        stmt = (
            select(Message)
            .where(Message.chatId == chatId)
            .order_by(Message.createdAt.asc().nulls_last())
        )
        rows = list(sess.scalars(stmt))
    else:
        rows = get_message_path(sess, chat.active_leaf_message_id)

    messages = []
    for r in rows:
        toolCalls = json.loads(r.toolCalls) if r.toolCalls else None

        content = decode_message_content(r.content)

        if isinstance(content, list):
            _normalize_render_plan_blocks(content)

        attachments = None
        if r.attachments:
            raw_attachments = json.loads(r.attachments)
            attachments = raw_attachments

        msg_data = {
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

        if attachments:
            msg_data["attachments"] = attachments

        if isinstance(msg_data.get("content"), list):
            _normalize_render_plan_blocks(msg_data["content"])

        messages.append(msg_data)
    return messages


def _normalize_render_plan_blocks(blocks: List[Dict[str, Any]]) -> None:
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_call":
            render_plan = block.get("renderPlan")
            if isinstance(render_plan, dict):
                renderer = render_plan.get("renderer")
                if renderer == "markdown":
                    render_plan["renderer"] = "document"
            else:
                renderer = block.get("renderer")
                if renderer:
                    if renderer == "markdown":
                        renderer = "document"
                    block["renderPlan"] = {"renderer": renderer, "config": {}}

        if block.get("type") == "member_run":
            nested = block.get("content")
            if isinstance(nested, list):
                _normalize_render_plan_blocks(nested)


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
    starred: Optional[bool] = None,
) -> None:
    chat = sess.get(Chat, id)
    if not chat:
        return
    if title is not None:
        chat.title = title
    if model is not None:
        chat.model = model
    if updatedAt is not None:
        chat.updatedAt = updatedAt
    if starred is not None:
        chat.starred = starred
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
    message = sess.get(Message, messageId)
    if not message:
        return
    message.content = content
    if toolCalls is not None:
        message.toolCalls = json.dumps(toolCalls)
    sess.commit()


def get_message_path(sess: Session, leaf_id: str) -> List[Message]:
    path = []
    current_id = leaf_id

    while current_id:
        message = sess.get(Message, current_id)
        if not message:
            break
        path.append(message)
        current_id = message.parent_message_id

    return list(reversed(path))


def get_message_children(
    sess: Session, parent_id: Optional[str], chat_id: str
) -> List[Message]:
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
    stmt = (
        select(sqlalchemy.func.max(Message.sequence))
        .where(Message.parent_message_id == parent_id)
        .where(Message.chatId == chat_id)
    )
    max_seq = sess.scalar(stmt)
    return (max_seq or 0) + 1


def set_active_leaf(sess: Session, chat_id: str, leaf_id: str) -> None:
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
    message_id = str(uuid.uuid4())
    sequence = get_next_sibling_sequence(sess, parent_id, chat_id)

    model_used = None
    if role == "assistant":
        config = get_chat_agent_config(sess, chat_id)
        if config:
            provider = config.get("provider") or ""
            model_id = config.get("model_id") or ""
            if provider and model_id:
                model_used = f"{provider}:{model_id}"
            else:
                model_used = model_id or None

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
    message = sess.get(Message, message_id)
    if message:
        message.is_complete = True
        update_chat(sess, id=message.chatId, updatedAt=datetime.utcnow().isoformat())
        sess.commit()


def get_leaf_descendant(sess: Session, message_id: str, chat_id: str) -> str:
    current_id = message_id

    while True:
        children = get_message_children(sess, current_id, chat_id)
        if not children:
            return current_id
        current_id = children[-1].id


def get_chat_agent_config(sess: Session, chatId: str) -> Optional[Dict[str, Any]]:
    chat = sess.get(Chat, chatId)
    if not chat or not chat.agent_config:
        return None
    return json.loads(chat.agent_config)


def update_chat_agent_config(
    sess: Session,
    *,
    chatId: str,
    config: Dict[str, Any],
) -> None:
    chat = sess.get(Chat, chatId)
    if not chat:
        return

    chat.agent_config = json.dumps(config)
    sess.commit()


def get_default_agent_config() -> Dict[str, Any]:
    return {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "tool_ids": [],
        "instructions": [],
    }


def get_manifest_for_message(sess: Session, message_id: str) -> Optional[str]:
    current_id = message_id

    while current_id:
        message = sess.get(Message, current_id)
        if not message:
            break

        if message.manifest_id:
            return message.manifest_id

        current_id = message.parent_message_id

    return None


def set_message_manifest(sess: Session, message_id: str, manifest_id: str) -> None:
    message = sess.get(Message, message_id)
    if message:
        message.manifest_id = manifest_id
        sess.commit()
