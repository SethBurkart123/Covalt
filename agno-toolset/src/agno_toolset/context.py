"""
Tool execution context via contextvars.

Provides ambient context to tool functions without polluting their signatures.
Tools access context via get_context() when they need workspace path, chat_id, etc.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ToolContext:
    """
    Context available to tool functions during execution.

    Access via get_context() inside your tool function:

        from agno_toolset import tool, get_context

        @tool(name="Write File")
        def write_file(path: str, content: str) -> dict:
            ctx = get_context()
            target = ctx.workspace / path
            target.write_text(content)
            return {"path": path}
    """

    workspace: Path
    """Path to the chat's workspace directory."""

    chat_id: str
    """ID of the current chat."""

    toolset_id: str
    """ID of the toolset containing this tool."""

    # Extensible: add more fields as needed
    extra: dict[str, Any] | None = None
    """Additional context data for future extensibility."""


_context: ContextVar[ToolContext | None] = ContextVar("tool_context", default=None)


def get_context() -> ToolContext:
    """
    Get the current tool execution context.

    Call this inside your tool function to access workspace, chat_id, etc.

    Raises:
        RuntimeError: If called outside of tool execution.

    Returns:
        The current ToolContext.

    Example:
        @tool(name="Read File")
        def read_file(path: str) -> dict:
            ctx = get_context()
            content = (ctx.workspace / path).read_text()
            return {"content": content}
    """
    ctx = _context.get()
    if ctx is None:
        raise RuntimeError(
            "get_context() called outside of tool execution. "
            "This function should only be called from within a @tool decorated function."
        )
    return ctx


def set_context(ctx: ToolContext) -> None:
    """
    Set the tool execution context.

    This is called by the toolset executor before running a tool.
    Tool authors should not call this directly.
    """
    _context.set(ctx)


def clear_context() -> None:
    """
    Clear the tool execution context.

    This is called by the toolset executor after a tool completes.
    Tool authors should not call this directly.
    """
    _context.set(None)
