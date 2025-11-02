from __future__ import annotations

import sqlalchemy
from typing import Union
from pytauri import App, AppHandle
from pytauri.ffi.webview import WebviewWindow

from .core import _get_engine


def run_migrations(app: Union[App, AppHandle, WebviewWindow]) -> None:
    """Run database migrations for schema changes."""
    engine = _get_engine()
    if engine is None:
        return
    
    # Migration: Add agent_config column to chats table if it doesn't exist
    try:
        with engine.connect() as conn:
            # Check if column exists by trying to query it
            result = conn.execute(
                sqlalchemy.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='chats'")
            )
            table_def = result.fetchone()
            
            if table_def and 'agent_config' not in table_def[0]:
                # Column doesn't exist, add it
                print("[db] Running migration: Adding agent_config column to chats table")
                conn.execute(
                    sqlalchemy.text("ALTER TABLE chats ADD COLUMN agent_config TEXT")
                )
                conn.commit()
                print("[db] Migration completed successfully")
    except Exception as e:
        print(f"[db] Migration warning (may be safe to ignore if column exists): {e}")
    
    # Migration: Add branching columns to messages table
    try:
        with engine.connect() as conn:
            result = conn.execute(
                sqlalchemy.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
            )
            table_def = result.fetchone()
            
            if table_def:
                needs_migration = False
                
                if 'parent_message_id' not in table_def[0]:
                    print("[db] Running migration: Adding parent_message_id column to messages table")
                    conn.execute(
                        sqlalchemy.text("ALTER TABLE messages ADD COLUMN parent_message_id TEXT")
                    )
                    needs_migration = True
                
                if 'is_complete' not in table_def[0]:
                    print("[db] Running migration: Adding is_complete column to messages table")
                    conn.execute(
                        sqlalchemy.text("ALTER TABLE messages ADD COLUMN is_complete INTEGER DEFAULT 1 NOT NULL")
                    )
                    needs_migration = True
                
                if 'sequence' not in table_def[0]:
                    print("[db] Running migration: Adding sequence column to messages table")
                    conn.execute(
                        sqlalchemy.text("ALTER TABLE messages ADD COLUMN sequence INTEGER DEFAULT 1 NOT NULL")
                    )
                    needs_migration = True

                if 'model_used' not in table_def[0]:
                    print("[db] Running migration: Adding model_used column to messages table")
                    conn.execute(
                        sqlalchemy.text("ALTER TABLE messages ADD COLUMN model_used TEXT")
                    )
                    needs_migration = True
                
                if needs_migration:
                    conn.commit()
                    print("[db] Messages table migration completed")
    except Exception as e:
        print(f"[db] Migration warning for messages table: {e}")
    
    # Migration: Add active_leaf_message_id to chats table
    try:
        with engine.connect() as conn:
            result = conn.execute(
                sqlalchemy.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='chats'")
            )
            table_def = result.fetchone()
            
            if table_def and 'active_leaf_message_id' not in table_def[0]:
                print("[db] Running migration: Adding active_leaf_message_id column to chats table")
                conn.execute(
                    sqlalchemy.text("ALTER TABLE chats ADD COLUMN active_leaf_message_id TEXT")
                )
                conn.commit()
                print("[db] Chats table active_leaf migration completed")
    except Exception as e:
        print(f"[db] Migration warning for chats table: {e}")

    # Migration: Add 'extra' column to provider_settings table
    try:
        with engine.connect() as conn:
            result = conn.execute(
                sqlalchemy.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_settings'")
            )
            table_def = result.fetchone()
            if table_def and ' extra ' not in (table_def[0] or '') and '"extra"' not in (table_def[0] or ''):
                print("[db] Running migration: Adding extra column to provider_settings table")
                conn.execute(
                    sqlalchemy.text("ALTER TABLE provider_settings ADD COLUMN extra TEXT")
                )
                conn.commit()
                print("[db] provider_settings table migration completed")
    except Exception as e:
        print(f"[db] Migration warning for provider_settings table: {e}")
    
    # Backfill: Set active_leaf_message_id to last message in each chat
    try:
        with engine.connect() as conn:
            # Get all chats
            chats = conn.execute(sqlalchemy.text("SELECT id FROM chats")).fetchall()
            
            for (chat_id,) in chats:
                # Get last message in chat (by creation order)
                result = conn.execute(
                    sqlalchemy.text(
                        "SELECT id FROM messages WHERE chatId = :chat_id ORDER BY createdAt DESC LIMIT 1"
                    ),
                    {"chat_id": chat_id}
                )
                last_message = result.fetchone()
                
                if last_message:
                    conn.execute(
                        sqlalchemy.text(
                            "UPDATE chats SET active_leaf_message_id = :msg_id WHERE id = :chat_id"
                        ),
                        {"msg_id": last_message[0], "chat_id": chat_id}
                    )
            
            conn.commit()
            print("[db] Backfilled active_leaf_message_id for all chats")
    except Exception as e:
        print(f"[db] Backfill warning: {e}")
