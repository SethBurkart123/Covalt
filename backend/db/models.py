from __future__ import annotations

from typing import List, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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
    active_leaf_message_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    messages: Mapped[List["Message"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chatId: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    createdAt: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    toolCalls: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parent_message_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    model_used: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    chat: Mapped[Chat] = relationship(back_populates="messages")


class ProviderSettings(Base):
    __tablename__ = "provider_settings"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    api_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    base_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # JSON string with provider-specific options
    extra: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class UserSettings(Base):
    __tablename__ = "user_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class Model(Base):
    __tablename__ = "models"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    model_id: Mapped[str] = mapped_column(String, primary_key=True)
    parse_think_tags: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    extra: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ActiveStream(Base):
    """Tracks currently active streaming sessions for multi-frontend support."""

    __tablename__ = "active_streams"

    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Status: "streaming", "paused_hitl", "completed", "error", "interrupted"
    status: Mapped[str] = mapped_column(String, default="streaming", nullable=False)
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    # Optional error message if status is "error"
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
