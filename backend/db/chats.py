from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import orjson
import sqlalchemy
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import decode_message_content, normalize_renderer_alias
from .models import Chat, Message


def list_chats(sess: Session) -> list[Chat]:
    stmt = select(Chat).order_by(
        Chat.updatedAt.desc().nulls_last(), Chat.createdAt.desc().nulls_last()
    )
    return list(sess.scalars(stmt))


def list_starred_chats(sess: Session) -> list[Chat]:
    stmt = (
        select(Chat)
        .where(Chat.starred.is_(True))
        .order_by(Chat.updatedAt.desc().nulls_last(), Chat.id.desc())
    )
    return list(sess.scalars(stmt))


def list_chats_page(
    sess: Session,
    *,
    limit: int,
    cursor_updated_at: str | None = None,
    cursor_id: str | None = None,
) -> tuple[list[Chat], bool]:
    """Cursor-paginated, non-starred chats ordered by (updatedAt DESC, id DESC).
    Returns (rows, has_more)."""
    stmt = select(Chat).where(Chat.starred.is_(False))
    if cursor_updated_at is not None and cursor_id is not None:
        stmt = stmt.where(
            sqlalchemy.or_(
                Chat.updatedAt < cursor_updated_at,
                sqlalchemy.and_(
                    Chat.updatedAt == cursor_updated_at, Chat.id < cursor_id
                ),
            )
        )
    stmt = stmt.order_by(
        Chat.updatedAt.desc().nulls_last(), Chat.id.desc()
    ).limit(limit + 1)
    rows = list(sess.scalars(stmt))
    has_more = len(rows) > limit
    return rows[:limit], has_more


def _message_to_dict(r: Message) -> dict[str, Any]:
    toolCalls = orjson.loads(r.toolCalls) if r.toolCalls else None

    content = decode_message_content(r.content)
    if isinstance(content, list):
        _normalize_render_plan_blocks(content)

    msg_data: dict[str, Any] = {
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

    if r.attachments:
        msg_data["attachments"] = orjson.loads(r.attachments)

    return msg_data


def get_chat_message_path(sess: Session, chatId: str) -> list[Message]:
    chat = sess.get(Chat, chatId)
    if not chat or not chat.active_leaf_message_id:
        stmt = (
            select(Message)
            .where(Message.chatId == chatId)
            .order_by(Message.createdAt.asc().nulls_last())
        )
        return list(sess.scalars(stmt))
    return get_message_path(sess, chat.active_leaf_message_id)


def get_chat_messages(sess: Session, chatId: str) -> list[dict[str, Any]]:
    return [_message_to_dict(r) for r in get_chat_message_path(sess, chatId)]


def get_chat_messages_page(
    sess: Session,
    chatId: str,
    *,
    limit: int,
    before_message_id: str | None = None,
) -> tuple[list[dict[str, Any]], bool, str | None]:
    chat = sess.get(Chat, chatId)
    if chat and chat.active_leaf_message_id:
        rows, has_more = get_message_path_page(
            sess,
            chatId,
            chat.active_leaf_message_id,
            limit=limit,
            before_message_id=before_message_id,
        )
    else:
        rows, has_more = get_linear_chat_messages_page(
            sess,
            chatId,
            limit=limit,
            before_message_id=before_message_id,
        )

    next_cursor = rows[0].id if has_more and rows else None
    return [_message_to_dict(r) for r in rows], has_more, next_cursor


def _normalize_render_plan_blocks(blocks: list[dict[str, Any]]) -> None:
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_call":
            if block.get("failed"):
                block.pop("renderPlan", None)
            else:
                render_plan = block.get("renderPlan")
                if isinstance(render_plan, dict):
                    renderer = normalize_renderer_alias(render_plan.get("renderer"))
                    if renderer:
                        render_plan["renderer"] = renderer
                else:
                    renderer = normalize_renderer_alias(block.get("renderer"))
                    if renderer:
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
    model: str | None,
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
    title: str | None = None,
    model: str | None = None,
    updatedAt: str | None = None,
    starred: bool | None = None,
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
    toolCalls: list[dict[str, Any]] | None = None,
) -> None:
    sess.add(
        Message(
            id=id,
            chatId=chatId,
            role=role,
            content=content,
            createdAt=createdAt,
            toolCalls=orjson.dumps(toolCalls).decode() if toolCalls is not None else None,
        )
    )
    sess.commit()


def update_message_content(
    sess: Session,
    *,
    messageId: str,
    content: str,
    toolCalls: list[dict[str, Any]] | None = None,
) -> None:
    message = sess.get(Message, messageId)
    if not message:
        return
    message.content = content
    if toolCalls is not None:
        message.toolCalls = orjson.dumps(toolCalls).decode()
    sess.commit()


def get_message_path(sess: Session, leaf_id: str) -> list[Message]:
    """Walk from leaf to root in a single recursive CTE query."""
    cte_sql = text("""
        WITH RECURSIVE ancestors(id, depth) AS (
            SELECT :leaf_id, 0
            UNION ALL
            SELECT m.parent_message_id, a.depth + 1
            FROM messages m
            JOIN ancestors a ON m.id = a.id
            WHERE m.parent_message_id IS NOT NULL
        )
        SELECT id FROM ancestors ORDER BY depth DESC
    """)
    ids = [r[0] for r in sess.execute(cte_sql, {"leaf_id": leaf_id}).fetchall()]
    return _messages_in_id_order(sess, ids)


def _messages_in_id_order(sess: Session, ids: list[str]) -> list[Message]:
    if not ids:
        return []
    messages_by_id = {
        m.id: m for m in sess.scalars(select(Message).where(Message.id.in_(ids)))
    }
    return [msg for msg_id in ids if (msg := messages_by_id.get(msg_id))]


def get_message_path_page(
    sess: Session,
    chatId: str,
    leaf_id: str,
    *,
    limit: int,
    before_message_id: str | None = None,
) -> tuple[list[Message], bool]:
    params = {
        "chat_id": chatId,
        "leaf_id": leaf_id,
        "before_message_id": before_message_id,
        "limit_plus_one": limit + 1,
    }
    cte_sql = text("""
        WITH RECURSIVE ancestors(id, depth) AS (
            SELECT :leaf_id, 0
            UNION ALL
            SELECT m.parent_message_id, a.depth + 1
            FROM messages m
            JOIN ancestors a ON m.id = a.id
            WHERE m.parent_message_id IS NOT NULL AND m."chatId" = :chat_id
        ), cursor AS (
            SELECT COALESCE(
                (SELECT depth FROM ancestors WHERE id = :before_message_id LIMIT 1),
                -1
            ) AS depth
        )
        SELECT id FROM ancestors
        WHERE depth > (SELECT depth FROM cursor)
        ORDER BY depth ASC
        LIMIT :limit_plus_one
    """)
    ids = [r[0] for r in sess.execute(cte_sql, params).fetchall()]
    has_more = len(ids) > limit
    return _messages_in_id_order(sess, list(reversed(ids[:limit]))), has_more


def get_linear_chat_messages_page(
    sess: Session,
    chatId: str,
    *,
    limit: int,
    before_message_id: str | None = None,
) -> tuple[list[Message], bool]:
    cursor_created_at = None
    if before_message_id:
        cursor_msg = sess.get(Message, before_message_id)
        cursor_created_at = cursor_msg.createdAt if cursor_msg else None

    stmt = select(Message).where(Message.chatId == chatId)
    if before_message_id and cursor_created_at is None:
        return [], False
    if cursor_created_at is not None:
        stmt = stmt.where(Message.createdAt < cursor_created_at)
    stmt = stmt.order_by(Message.createdAt.desc().nulls_last()).limit(limit + 1)
    rows = list(sess.scalars(stmt))
    has_more = len(rows) > limit
    return list(reversed(rows[:limit])), has_more


def get_message_children(
    sess: Session, parent_id: str | None, chat_id: str
) -> list[Message]:
    stmt = (
        select(Message)
        .where(Message.parent_message_id == parent_id)
        .where(Message.chatId == chat_id)
        .order_by(Message.sequence.asc())
    )
    return list(sess.scalars(stmt))


def get_next_sibling_sequence(
    sess: Session, parent_id: str | None, chat_id: str
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
    parent_id: str | None,
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
            agent_id = config.get("agent_id") or ""
            if agent_id:
                model_used = f"agent:{agent_id}"
            else:
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
    """Walk down to the deepest last-child descendant in a single CTE query.

    Picks the highest-sequence child at each level (matching the old behavior
    of ``children[-1]``).
    """
    cte_sql = text("""
        WITH RECURSIVE descendants(id, depth) AS (
            SELECT :message_id, 0
            UNION ALL
            SELECT (
                SELECT m.id FROM messages m
                WHERE m.parent_message_id = d.id AND m."chatId" = :chat_id
                ORDER BY m.sequence DESC LIMIT 1
            ), d.depth + 1
            FROM descendants d
            WHERE d.id IS NOT NULL
        )
        SELECT id FROM descendants WHERE id IS NOT NULL
        ORDER BY depth DESC LIMIT 1
    """)
    row = sess.execute(cte_sql, {"message_id": message_id, "chat_id": chat_id}).fetchone()
    return row[0] if row else message_id


def get_chat_agent_config(sess: Session, chatId: str) -> dict[str, Any] | None:
    chat = sess.get(Chat, chatId)
    if not chat or not chat.agent_config:
        return None
    return orjson.loads(chat.agent_config)


def update_chat_agent_config(
    sess: Session,
    *,
    chatId: str,
    config: dict[str, Any],
) -> None:
    chat = sess.get(Chat, chatId)
    if not chat:
        return

    chat.agent_config = orjson.dumps(config).decode()
    sess.commit()


def get_default_agent_config() -> dict[str, Any]:
    return {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "tool_ids": [],
        "instructions": [],
    }


def get_manifest_for_message(sess: Session, message_id: str) -> str | None:
    """Find the nearest ancestor (inclusive) with a manifest_id in a single CTE."""
    cte_sql = text("""
        WITH RECURSIVE ancestors(id) AS (
            SELECT :message_id
            UNION ALL
            SELECT m.parent_message_id
            FROM messages m
            JOIN ancestors a ON m.id = a.id
            WHERE m.parent_message_id IS NOT NULL
        )
        SELECT m.manifest_id
        FROM ancestors a
        JOIN messages m ON m.id = a.id
        WHERE m.manifest_id IS NOT NULL
        LIMIT 1
    """)
    row = sess.execute(cte_sql, {"message_id": message_id}).fetchone()
    return row[0] if row else None


def set_message_manifest(sess: Session, message_id: str, manifest_id: str) -> None:
    message = sess.get(Message, message_id)
    if message:
        message.manifest_id = manifest_id
        sess.commit()
