from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from .core import _get_engine

logger = logging.getLogger(__name__)


def run_migrations() -> None:
    engine = _get_engine()
    if engine is None:
        return

    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    with engine.connect() as conn:
        if "chats" in existing_tables:
            chats_columns = [col["name"] for col in inspector.get_columns("chats")]
            if "starred" not in chats_columns:
                conn.execute(
                    text(
                        "ALTER TABLE chats ADD COLUMN starred BOOLEAN DEFAULT 0 NOT NULL"
                    )
                )
                conn.commit()
                logger.info("Added starred column to chats table")

            if "active_manifest_id" not in chats_columns:
                conn.execute(
                    text("ALTER TABLE chats ADD COLUMN active_manifest_id TEXT")
                )
                conn.commit()
                logger.info("Added active_manifest_id column to chats table")

        if "mcp_servers" in existing_tables:
            mcp_columns = [col["name"] for col in inspector.get_columns("mcp_servers")]
            if "toolset_id" not in mcp_columns:
                conn.execute(text("ALTER TABLE mcp_servers ADD COLUMN toolset_id TEXT"))
                conn.commit()
                logger.info("Added toolset_id column to mcp_servers table")

        if "messages" in existing_tables:
            messages_columns = [
                col["name"] for col in inspector.get_columns("messages")
            ]
            if "manifest_id" not in messages_columns:
                conn.execute(text("ALTER TABLE messages ADD COLUMN manifest_id TEXT"))
                conn.commit()
                logger.info("Added manifest_id column to messages table")
