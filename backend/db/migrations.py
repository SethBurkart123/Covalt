from __future__ import annotations

from sqlalchemy import inspect, text

from .core import _get_engine


def run_migrations() -> None:
    """Run database migrations for schema changes."""
    engine = _get_engine()
    if engine is None:
        return

    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    with engine.connect() as conn:
        if "active_streams" not in existing_tables:
            conn.execute(
                text(
                    """
                CREATE TABLE active_streams (
                    chat_id VARCHAR NOT NULL,
                    message_id VARCHAR NOT NULL,
                    run_id VARCHAR,
                    status VARCHAR NOT NULL DEFAULT 'streaming',
                    started_at VARCHAR NOT NULL,
                    updated_at VARCHAR NOT NULL,
                    error_message TEXT,
                    PRIMARY KEY (chat_id),
                    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
                )
            """
                )
            )
            conn.commit()

        if "active_streams" in existing_tables or "active_streams" in inspector.get_table_names():
            conn.execute(
                text(
                    """
                UPDATE active_streams 
                SET status = 'interrupted', updated_at = datetime('now')
                WHERE status IN ('streaming', 'paused_hitl')
            """
                )
            )
            conn.commit()