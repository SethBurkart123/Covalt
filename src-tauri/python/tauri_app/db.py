from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pytauri import App, AppHandle, Manager
from pytauri.ffi.webview import WebviewWindow
from pytauri.path import PathResolver
import sqlalchemy
from sqlalchemy import Boolean, String, Text, ForeignKey, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker, Session


class Base(DeclarativeBase):
    pass


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    createdAt: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    updatedAt: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    agent_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    messages: Mapped[List["Message"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chatId: Mapped[str] = mapped_column(String, ForeignKey("chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    createdAt: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    toolCalls: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    chat: Mapped[Chat] = relationship(back_populates="messages")


class ProviderSettings(Base):
    __tablename__ = "provider_settings"
    
    provider: Mapped[str] = mapped_column(String, primary_key=True)
    api_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    base_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class UserSettings(Base):
    __tablename__ = "user_settings"
    
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


_engine = None
_Session = None
_db_path_override: Optional[Path] = None


def set_db_path(path: Path) -> None:
    global _db_path_override
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_path_override = path


def get_db_path(app: Union[App, AppHandle, WebviewWindow]) -> Path:
    # Fallback if not set via init_database
    return _db_path_override or (get_resource_dir(app) / "app.db")

def get_resource_dir(manager: Union[App, AppHandle, WebviewWindow]) -> Path:
    path_resolver: PathResolver = Manager.path(manager)
    return path_resolver.resource_dir()

def _ensure_engine(app: Union[App, AppHandle, WebviewWindow]):
    global _engine, _Session
    if _engine is None:
        db_path = get_db_path(app)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(_engine)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)


def init_database(app: Union[App, AppHandle, WebviewWindow]) -> Path:
    """Ensure the database engine and schema exist. Returns DB path."""
    _ensure_engine(app)
    _run_migrations(app)
    return get_db_path(app)


def _run_migrations(app: Union[App, AppHandle, WebviewWindow]) -> None:
    """Run database migrations for schema changes."""
    global _engine
    if _engine is None:
        return
    
    # Migration: Add agent_config column to chats table if it doesn't exist
    try:
        with _engine.connect() as conn:
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


def session(app: Union[App, AppHandle, WebviewWindow]) -> Session:
    _ensure_engine(app)
    assert _Session is not None
    return _Session()


@contextmanager
def db_session(app: Union[App, AppHandle, WebviewWindow]):
    """Context manager for database sessions - handles cleanup automatically."""
    sess = session(app)
    try:
        yield sess
    finally:
        sess.close()


def list_chats(sess: Session) -> List[Chat]:
    stmt = select(Chat).order_by(Chat.updatedAt.desc().nulls_last(), Chat.createdAt.desc().nulls_last())
    return list(sess.scalars(stmt))


def get_chat_messages(sess: Session, chatId: str) -> List[Dict[str, Any]]:
    stmt = select(Message).where(Message.chatId == chatId).order_by(Message.createdAt.asc().nulls_last())
    rows = list(sess.scalars(stmt))
    messages: List[Dict[str, Any]] = []
    for r in rows:
        toolCalls = json.loads(r.toolCalls) if r.toolCalls else None
        
        # Parse content if it's a JSON array (structured content blocks)
        content = r.content
        if content and content.strip().startswith('['):
            try:
                content = json.loads(content)
            except Exception:
                # If parsing fails, keep as string (legacy format)
                pass
        
        messages.append(
            {
                "id": r.id,
                "role": r.role,
                "content": content,
                "createdAt": r.createdAt,
                "toolCalls": toolCalls,
            }
        )
    return messages


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
) -> None:
    chat: Optional[Chat] = sess.get(Chat, id)
    if not chat:
        return
    if title is not None:
        chat.title = title
    if model is not None:
        chat.model = model
    if updatedAt is not None:
        chat.updatedAt = updatedAt
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
    """Append a new message to a chat."""
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
    """Update the content of an existing message (for streaming updates)."""
    message: Optional[Message] = sess.get(Message, messageId)
    if not message:
        return
    message.content = content
    if toolCalls is not None:
        message.toolCalls = json.dumps(toolCalls)
    sess.commit()


def delete_chat(sess: Session, *, chatId: str) -> None:
    chat = sess.get(Chat, chatId)
    if chat:
        sess.delete(chat)
        sess.commit()


def get_chat_agent_config(sess: Session, chatId: str) -> Optional[Dict[str, Any]]:
    """
    Get agent configuration for a chat.
    
    Returns:
        Agent config dict or None if not set
    """
    chat: Optional[Chat] = sess.get(Chat, chatId)
    if not chat or not chat.agent_config:
        return None
    
    try:
        return json.loads(chat.agent_config)
    except Exception:
        return None


def update_chat_agent_config(
    sess: Session,
    *,
    chatId: str,
    config: Dict[str, Any],
) -> None:
    """
    Update agent configuration for a chat.
    
    Args:
        sess: Database session
        chatId: Chat identifier
        config: Agent configuration dict (provider, model_id, tool_ids, etc.)
    """
    chat: Optional[Chat] = sess.get(Chat, chatId)
    if not chat:
        return
    
    chat.agent_config = json.dumps(config)
    sess.commit()


def get_default_agent_config() -> Dict[str, Any]:
    """
    Get default agent configuration for new chats.
    
    Returns:
        Default config with openai provider and no tools
    """
    return {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "tool_ids": [],
        "instructions": [],
    }


# Provider Settings Functions


def get_provider_settings(sess: Session, provider: str) -> Optional[Dict[str, Any]]:
    """
    Get settings for a specific provider.
    
    Args:
        sess: Database session
        provider: Provider name (openai, anthropic, groq, ollama)
        
    Returns:
        Provider settings dict or None if not found
    """
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)
    if not settings:
        return None
    
    return {
        "provider": settings.provider,
        "api_key": settings.api_key,
        "base_url": settings.base_url,
        "enabled": settings.enabled,
    }


def get_all_provider_settings(sess: Session) -> Dict[str, Dict[str, Any]]:
    """
    Get all provider settings.
    
    Args:
        sess: Database session
        
    Returns:
        Dict mapping provider name to settings dict
    """
    stmt = select(ProviderSettings)
    rows = list(sess.scalars(stmt))
    
    result = {}
    for row in rows:
        result[row.provider] = {
            "provider": row.provider,
            "api_key": row.api_key,
            "base_url": row.base_url,
            "enabled": row.enabled,
        }
    return result


def save_provider_settings(
    sess: Session,
    *,
    provider: str,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    enabled: bool = True,
) -> None:
    """
    Save or update provider settings.
    
    Args:
        sess: Database session
        provider: Provider name (openai, anthropic, groq, ollama)
        api_key: API key for the provider
        base_url: Base URL for the provider (optional, for custom endpoints)
        enabled: Whether the provider is enabled
    """
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)
    
    if settings:
        # Update existing
        if api_key is not None:
            settings.api_key = api_key
        if base_url is not None:
            settings.base_url = base_url
        settings.enabled = enabled
    else:
        # Create new
        settings = ProviderSettings(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            enabled=enabled,
        )
        sess.add(settings)
    
    sess.commit()


# User Settings Functions


def get_user_setting(sess: Session, key: str) -> Optional[str]:
    """
    Get a user setting value.
    
    Args:
        sess: Database session
        key: Setting key
        
    Returns:
        Setting value or None if not found
    """
    setting: Optional[UserSettings] = sess.get(UserSettings, key)
    return setting.value if setting else None


def set_user_setting(sess: Session, key: str, value: str) -> None:
    """
    Set a user setting value.
    
    Args:
        sess: Database session
        key: Setting key
        value: Setting value (will be stored as string)
    """
    setting: Optional[UserSettings] = sess.get(UserSettings, key)
    
    if setting:
        setting.value = value
    else:
        setting = UserSettings(key=key, value=value)
        sess.add(setting)
    
    sess.commit()


def get_default_tool_ids(sess: Session) -> List[str]:
    """
    Get default tool IDs for new chats.
    
    Args:
        sess: Database session
        
    Returns:
        List of tool IDs
    """
    value = get_user_setting(sess, "default_tool_ids")
    if not value:
        return []
    
    try:
        import json
        tool_ids = json.loads(value)
        return tool_ids if isinstance(tool_ids, list) else []
    except Exception:
        return []


def set_default_tool_ids(sess: Session, tool_ids: List[str]) -> None:
    """
    Set default tool IDs for new chats.
    
    Args:
        sess: Database session
        tool_ids: List of tool IDs
    """
    import json
    value = json.dumps(tool_ids)
    set_user_setting(sess, "default_tool_ids", value)
