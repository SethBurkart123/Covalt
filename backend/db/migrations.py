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
    
    # Migration: Create models table or migrate from model_settings
    try:
        with engine.connect() as conn:
            # Check if models table exists
            result = conn.execute(
                sqlalchemy.text("SELECT name FROM sqlite_master WHERE type='table' AND name='models'")
            )
            models_table_exists = result.fetchone()
            
            # Check if old model_settings table exists
            result = conn.execute(
                sqlalchemy.text("SELECT name FROM sqlite_master WHERE type='table' AND name='model_settings'")
            )
            old_table_exists = result.fetchone()
            
            if not models_table_exists:
                if old_table_exists:
                    # Migrate from old table structure
                    print("[db] Running migration: Migrating model_settings to models table")
                    
                    # Create new models table
                    conn.execute(
                        sqlalchemy.text("""
                            CREATE TABLE models (
                                provider TEXT NOT NULL,
                                model_id TEXT NOT NULL,
                                parse_think_tags INTEGER DEFAULT 0 NOT NULL,
                                extra TEXT,
                                PRIMARY KEY (provider, model_id)
                            )
                        """)
                    )
                    
                    # Migrate data: move reasoning fields to extra JSON
                    conn.execute(
                        sqlalchemy.text("""
                            INSERT INTO models (provider, model_id, parse_think_tags, extra)
                            SELECT 
                                provider,
                                model_id,
                                0 as parse_think_tags,
                                CASE 
                                    WHEN supports_reasoning = 1 OR is_user_override = 1 THEN
                                        json_object(
                                            'reasoning', json_object(
                                                'supports', supports_reasoning,
                                                'isUserOverride', is_user_override
                                            )
                                        )
                                    ELSE NULL
                                END as extra
                            FROM model_settings
                        """)
                    )
                    
                    # Drop old table
                    conn.execute(sqlalchemy.text("DROP TABLE model_settings"))
                    conn.commit()
                    print("[db] Successfully migrated model_settings to models table")
                else:
                    # Create new table from scratch
                    print("[db] Running migration: Creating models table")
                    conn.execute(
                        sqlalchemy.text("""
                            CREATE TABLE models (
                                provider TEXT NOT NULL,
                                model_id TEXT NOT NULL,
                                parse_think_tags INTEGER DEFAULT 0 NOT NULL,
                                extra TEXT,
                                PRIMARY KEY (provider, model_id)
                            )
                        """)
                    )
                    conn.commit()
                    print("[db] models table created successfully")
    except Exception as e:
        print(f"[db] Migration warning for models table: {e}")
    
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
