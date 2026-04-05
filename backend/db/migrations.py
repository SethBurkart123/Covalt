from __future__ import annotations

from sqlalchemy import text

from .core import _get_engine


_INDEX_DEFINITIONS = [
    ("ix_messages_chat_id", "messages", '"chatId"'),
    ("ix_messages_parent_id_chat_id", "messages", "parent_message_id, \"chatId\""),
    ("ix_messages_chat_created", "messages", '"chatId", "createdAt"'),
    ("ix_tool_calls_chat_message", "tool_calls", "chat_id, message_id"),
    ("ix_execution_runs_message_id", "execution_runs", "message_id"),
]


def run_migrations() -> None:
    engine = _get_engine()
    if engine is None:
        return

    with engine.connect() as conn:
        for name, table, columns in _INDEX_DEFINITIONS:
            conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")
            )
        conn.commit()
