from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any, Optional

from .. import db
from .model_selection import parse_model_id, update_chat_model_selection


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
            config: dict[str, Any] = {
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


def save_user_message(
    message: Any,
    chat_id: str,
    parent_id: Optional[str] = None,
    attachments: Optional[list[Any]] = None,
    manifest_id: Optional[str] = None,
) -> None:
    with db.db_session() as sess:
        now = datetime.now(UTC).isoformat()
        db_message = db.Message(
            id=message.id,
            chatId=chat_id,
            role=message.role,
            content=message.content,
            createdAt=message.createdAt or now,
            parent_message_id=parent_id,
            is_complete=True,
            sequence=db.get_next_sibling_sequence(sess, parent_id, chat_id),
            attachments=json.dumps([attachment.model_dump() for attachment in attachments])
            if attachments
            else None,
            manifest_id=manifest_id,
        )
        sess.add(db_message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, message.id)
        db.update_chat(sess, id=chat_id, updatedAt=now)


def init_assistant_message(chat_id: str, parent_id: Optional[str]) -> str:
    message_id = str(uuid.uuid4())
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
            id=message_id,
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

        db.set_active_leaf(sess, chat_id, message_id)
        db.update_chat(sess, id=chat_id, updatedAt=now)
    return message_id


def get_active_leaf_message_id(chat_id: str) -> Optional[str]:
    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        return chat.active_leaf_message_id if chat else None
