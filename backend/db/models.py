from __future__ import annotations

from sqlalchemy import (
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    createdAt: Mapped[str | None] = mapped_column(String, nullable=True)
    updatedAt: Mapped[str | None] = mapped_column(String, nullable=True)
    agent_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_leaf_message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active_manifest_id: Mapped[str | None] = mapped_column(String, nullable=True)

    messages: Mapped[list[Message]] = relationship(
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
    createdAt: Mapped[str | None] = mapped_column(String, nullable=True)
    toolCalls: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    attachments: Mapped[str | None] = mapped_column(Text, nullable=True)
    manifest_id: Mapped[str | None] = mapped_column(String, nullable=True)

    chat: Mapped[Chat] = relationship(back_populates="messages")

    __table_args__ = (
        Index("ix_messages_chat_id", "chatId"),
        Index("ix_messages_parent_id_chat_id", "parent_message_id", "chatId"),
        Index("ix_messages_chat_created", "chatId", "createdAt"),
    )


class ProviderSettings(Base):
    __tablename__ = "provider_settings"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    api_key: Mapped[str | None] = mapped_column(String, nullable=True)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)


class ExecutionRun(Base):
    __tablename__ = "execution_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="streaming")
    root_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    ended_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_execution_runs_message_id", "message_id"),
    )


class ExecutionEvent(Base):
    __tablename__ = "execution_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    execution_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("execution_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    node_type: Mapped[str | None] = mapped_column(String, nullable=True)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "execution_id", "seq", name="uq_execution_events_execution_seq"
        ),
    )


class ToolsetMcpServer(Base):
    __tablename__ = "toolset_mcp_servers"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    toolset_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("toolsets.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    server_type: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    command: Mapped[str | None] = mapped_column(String, nullable=True)
    args: Mapped[str | None] = mapped_column(Text, nullable=True)
    cwd: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    headers: Mapped[str | None] = mapped_column(Text, nullable=True)
    env: Mapped[str | None] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Toolset(Base):
    __tablename__ = "toolsets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    user_mcp: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    installed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    source_type: Mapped[str | None] = mapped_column(String, nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    manifest_version: Mapped[str] = mapped_column(String, default="1", nullable=False)

    files: Mapped[list[ToolsetFile]] = relationship(
        back_populates="toolset", cascade="all, delete-orphan"
    )
    tools: Mapped[list[Tool]] = relationship(
        back_populates="toolset", cascade="all, delete-orphan"
    )
    mcp_servers: Mapped[list[ToolsetMcpServer]] = relationship(
        backref="toolset", cascade="all, delete-orphan"
    )
    overrides: Mapped[list[ToolOverride]] = relationship(
        back_populates="toolset", cascade="all, delete-orphan"
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
    toolset_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_schema: Mapped[str | None] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    entrypoint: Mapped[str | None] = mapped_column(String, nullable=True)

    toolset: Mapped[Toolset | None] = relationship(back_populates="tools")


class WorkspaceManifest(Base):
    __tablename__ = "workspace_manifests"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    files: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, default="initial", nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String, nullable=True)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    args: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    render_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    pre_manifest_id: Mapped[str | None] = mapped_column(String, nullable=True)
    post_manifest_id: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("ix_tool_calls_chat_message", "chat_id", "message_id"),
    )


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    server_id: Mapped[str] = mapped_column(String, nullable=False)
    toolset_id: Mapped[str] = mapped_column(String, nullable=False)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_type: Mapped[str] = mapped_column(String, default="Bearer", nullable=False)
    expires_at: Mapped[str | None] = mapped_column(String, nullable=True)
    scope: Mapped[str | None] = mapped_column(String, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String, nullable=True)
    client_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["toolset_id", "server_id"],
            ["toolset_mcp_servers.toolset_id", "toolset_mcp_servers.id"],
            ondelete="CASCADE",
        ),
    )


class ProviderOAuthCredential(Base):
    __tablename__ = "provider_oauth_credentials"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_type: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[str | None] = mapped_column(String, nullable=True)
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String, nullable=True)


class ToolOverride(Base):
    __tablename__ = "tool_overrides"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    toolset_id: Mapped[str] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=False
    )
    tool_id: Mapped[str] = mapped_column(String, nullable=False)

    renderer: Mapped[str | None] = mapped_column(String, nullable=True)
    renderer_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    name_override: Mapped[str | None] = mapped_column(String, nullable=True)
    description_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    toolset: Mapped[Toolset] = relationship(back_populates="overrides")

    __table_args__ = (
        UniqueConstraint("toolset_id", "tool_id", name="uq_toolset_tool_override"),
    )


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Icon format: "emoji:🤖" | "lucide:Bot" | "image:icon.png" | null
    icon: Mapped[str | None] = mapped_column(String, nullable=True)

    # Preview screenshot filename (stored in agents/{id}/)
    preview_image: Mapped[str | None] = mapped_column(String, nullable=True)

    # Graph as JSON: {"nodes": [...], "edges": [...]}
    graph_data: Mapped[str] = mapped_column(
        Text, nullable=False, default='{"nodes":[],"edges":[]}'
    )

    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
