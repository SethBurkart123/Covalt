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
    starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active_manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

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
    attachments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    chat: Mapped[Chat] = relationship(back_populates="messages")


class ProviderSettings(Base):
    __tablename__ = "provider_settings"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    api_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    base_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
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
    __tablename__ = "active_streams"

    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="streaming", nullable=False)
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class McpServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    server_type: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    command: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    args: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cwd: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    headers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    env: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    tool_overrides: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    toolset_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=True
    )


class Toolset(Base):
    __tablename__ = "toolsets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    installed_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    manifest_version: Mapped[str] = mapped_column(String, default="1", nullable=False)

    files: Mapped[List["ToolsetFile"]] = relationship(
        back_populates="toolset", cascade="all, delete-orphan"
    )
    tools: Mapped[List["Tool"]] = relationship(
        back_populates="toolset", cascade="all, delete-orphan"
    )
    mcp_servers: Mapped[List["McpServer"]] = relationship(
        backref="toolset", cascade="all, delete-orphan"
    )


class ToolsetFile(Base):
    __tablename__ = "toolset_files"

    toolset_id: Mapped[str] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), primary_key=True
    )
    path: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    stored_path: Mapped[str] = mapped_column(String, nullable=False)

    toolset: Mapped[Toolset] = relationship(back_populates="files")


class Tool(Base):
    __tablename__ = "tools"

    tool_id: Mapped[str] = mapped_column(String, primary_key=True)
    toolset_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    input_schema: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    entrypoint: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    toolset: Mapped[Optional[Toolset]] = relationship(back_populates="tools")
    render_configs: Mapped[List["ToolRenderConfig"]] = relationship(
        back_populates="tool", cascade="all, delete-orphan"
    )


class ToolRenderConfig(Base):
    __tablename__ = "tool_render_configs"

    tool_id: Mapped[str] = mapped_column(
        String, ForeignKey("tools.tool_id", ondelete="CASCADE"), primary_key=True
    )
    priority: Mapped[int] = mapped_column(Integer, primary_key=True, default=0)
    renderer: Mapped[str] = mapped_column(String, nullable=False)
    config: Mapped[str] = mapped_column(Text, nullable=False)

    tool: Mapped[Tool] = relationship(back_populates="render_configs")


class WorkspaceManifest(Base):
    __tablename__ = "workspace_manifests"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    files: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, default="initial", nullable=False)
    source_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    args: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    render_plan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    finished_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pre_manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    post_manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
