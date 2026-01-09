from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from .core import _get_engine

logger = logging.getLogger(__name__)


def run_migrations() -> None:
    """Run database migrations for schema changes."""
    engine = _get_engine()
    if engine is None:
        return

    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    with engine.connect() as conn:
        # Add starred column to chats table
        if "chats" in existing_tables:
            chats_columns = [col["name"] for col in inspector.get_columns("chats")]
            if "starred" not in chats_columns:
                conn.execute(
                    text("ALTER TABLE chats ADD COLUMN starred BOOLEAN DEFAULT 0 NOT NULL")
                )
                conn.commit()
                logger.info("Added starred column to chats table")