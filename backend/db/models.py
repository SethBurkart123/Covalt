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
    # Current workspace manifest for this chat
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
    # JSON string of attachment metadata (id, type, name, mimeType, size)
    attachments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Workspace manifest ID at this point in the message tree
    manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

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


class McpServer(Base):
    """MCP server configuration stored in database."""

    __tablename__ = "mcp_servers"

    # Identity
    id: Mapped[str] = mapped_column(String, primary_key=True)

    # Server type: "stdio" | "sse" | "streamable-http"
    server_type: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # For stdio servers
    command: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    args: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    cwd: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # For HTTP/SSE servers
    url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    headers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON dict

    # Common config
    env: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON dict
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    tool_overrides: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON

    # Metadata
    created_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Link to toolset (if this server was added by a toolset)
    toolset_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=True
    )


# =============================================================================
# Toolset System Models
# =============================================================================


class Toolset(Base):
    """Installed toolset packages."""

    __tablename__ = "toolsets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    installed_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Source: "zip", "local", "url"
    source_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Schema version of toolset.yaml
    manifest_version: Mapped[str] = mapped_column(String, default="1", nullable=False)

    # Relationships
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
    """Files belonging to a toolset package."""

    __tablename__ = "toolset_files"

    toolset_id: Mapped[str] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), primary_key=True
    )
    path: Mapped[str] = mapped_column(String, primary_key=True)
    # Kind: "python", "artifact", "asset", "config"
    kind: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    # Absolute path where file is stored on disk
    stored_path: Mapped[str] = mapped_column(String, nullable=False)

    toolset: Mapped[Toolset] = relationship(back_populates="files")


class Tool(Base):
    """Logical tool registry (builtin + toolset tools)."""

    __tablename__ = "tools"

    tool_id: Mapped[str] = mapped_column(String, primary_key=True)
    # NULL for builtin tools
    toolset_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("toolsets.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String, default="utility", nullable=False)
    # JSON schema for arguments
    input_schema: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # For python tools: "module:function" (e.g., "tools.files:write_file")
    entrypoint: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    toolset: Mapped[Optional[Toolset]] = relationship(back_populates="tools")
    render_configs: Mapped[List["ToolRenderConfig"]] = relationship(
        back_populates="tool", cascade="all, delete-orphan"
    )


class ToolRenderConfig(Base):
    """Renderer configuration per tool."""

    __tablename__ = "tool_render_configs"

    tool_id: Mapped[str] = mapped_column(
        String, ForeignKey("tools.tool_id", ondelete="CASCADE"), primary_key=True
    )
    # Higher priority wins when multiple configs exist
    priority: Mapped[int] = mapped_column(Integer, primary_key=True, default=0)
    # Renderer type: "code", "document", "html", "frame"
    renderer: Mapped[str] = mapped_column(String, nullable=False)
    # JSON config object (file, content, language, editable, artifact, data, url, etc.)
    config: Mapped[str] = mapped_column(Text, nullable=False)

    tool: Mapped[Tool] = relationship(back_populates="render_configs")


class WorkspaceManifest(Base):
    """Versioned workspace state per chat (CAS manifests)."""

    __tablename__ = "workspace_manifests"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    # Parent manifest for branching
    parent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # JSON: {path: sha256, ...}
    files: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Source: "user_upload", "tool_run", "branch", "edit", "initial"
    source: Mapped[str] = mapped_column(String, default="initial", nullable=False)
    # Reference to message_id or tool_call_id that created this manifest
    source_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class ToolCall(Base):
    """Record of tool invocations."""

    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    tool_id: Mapped[str] = mapped_column(String, nullable=False)
    # JSON arguments
    args: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSON result (or summary)
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSON render plan for UI
    render_plan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Status: "pending", "running", "success", "error"
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    finished_at: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Workspace state before/after run
    pre_manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    post_manifest_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
