from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import inspect, text

from ..config import get_db_directory
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

        # Add attachments column to messages table
        if "messages" in existing_tables:
            messages_columns = [col["name"] for col in inspector.get_columns("messages")]
            if "attachments" not in messages_columns:
                conn.execute(
                    text("ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT NULL")
                )
                conn.commit()
                logger.info("Added attachments column to messages table")

        # MCP servers table migration
        mcp_table_existed = "mcp_servers" in existing_tables
        if not mcp_table_existed:
            conn.execute(
                text(
                    """
                CREATE TABLE mcp_servers (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    server_type VARCHAR NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT 1,
                    command VARCHAR,
                    args TEXT,
                    cwd VARCHAR,
                    url VARCHAR,
                    headers TEXT,
                    env TEXT,
                    requires_confirmation BOOLEAN NOT NULL DEFAULT 1,
                    tool_overrides TEXT,
                    created_at VARCHAR
                )
            """
                )
            )
            conn.commit()
            logger.info("Created mcp_servers table")

            _migrate_mcp_servers_from_json(conn)


def _migrate_mcp_servers_from_json(conn) -> None:
    """One-time migration: import MCP servers from JSON file to database."""
    json_path = get_db_directory() / "mcp_servers.json"
    if not json_path.exists():
        logger.info("No mcp_servers.json found, skipping migration")
        return

    try:
        with open(json_path) as f:
            data = json.load(f)

        servers = data.get("mcpServers", {})
        now = datetime.now().isoformat()

        for server_id, config in servers.items():
            server_type = config.get("type", "stdio")
            if "transport" in config:
                server_type = config["transport"]

            command = config.get("command")
            args = json.dumps(config.get("args")) if config.get("args") else None
            cwd = config.get("cwd")
            url = config.get("url")
            headers = json.dumps(config.get("headers")) if config.get("headers") else None
            env = json.dumps(config.get("env")) if config.get("env") else None
            requires_confirmation = config.get("requiresConfirmation", True)
            tool_overrides = (
                json.dumps(config.get("toolOverrides"))
                if config.get("toolOverrides")
                else None
            )

            conn.execute(
                text(
                    """
                INSERT INTO mcp_servers (
                    id, server_type, enabled, command, args, cwd, url, headers,
                    env, requires_confirmation, tool_overrides, created_at
                ) VALUES (
                    :id, :server_type, :enabled, :command, :args, :cwd, :url, :headers,
                    :env, :requires_confirmation, :tool_overrides, :created_at
                )
            """
                ),
                {
                    "id": server_id,
                    "server_type": server_type,
                    "enabled": True,
                    "command": command,
                    "args": args,
                    "cwd": cwd,
                    "url": url,
                    "headers": headers,
                    "env": env,
                    "requires_confirmation": requires_confirmation,
                    "tool_overrides": tool_overrides,
                    "created_at": now,
                },
            )

        conn.commit()
        logger.info(f"Migrated {len(servers)} MCP servers from JSON to database")

    except Exception as e:
        logger.error(f"Failed to migrate MCP servers from JSON: {e}")