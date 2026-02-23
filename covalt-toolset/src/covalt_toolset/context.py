"""Tool execution context via contextvars."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ToolContext:
    """Context available to tool functions during execution."""

    workspace: Path
    chat_id: str
    toolset_id: str
    extra: dict[str, Any] | None = None


_context: ContextVar[ToolContext | None] = ContextVar("tool_context", default=None)


def get_context() -> ToolContext:
    """Get the current tool execution context."""
    ctx = _context.get()
    if ctx is None:
        raise RuntimeError("get_context() called outside of tool execution")
    return ctx


def set_context(ctx: ToolContext) -> None:
    """Set the tool execution context (called by toolset executor)."""
    _context.set(ctx)


def clear_context() -> None:
    """Clear the tool execution context (called by toolset executor)."""
    _context.set(None)
