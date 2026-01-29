"""@tool decorator for defining toolset tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .schema import function_to_json_schema


@dataclass
class ToolMetadata:
    """Metadata extracted from a @tool decorated function."""

    name: str
    description: str | None
    schema: dict[str, Any]
    requires_confirmation: bool
    category: str | None


def tool(
    name: str | None = None,
    description: str | None = None,
    requires_confirmation: bool = False,
    category: str | None = None,
) -> Callable[[Callable], Callable]:
    """Decorator to mark a function as a toolset tool."""

    def decorator(fn: Callable) -> Callable:
        tool_name = name or fn.__name__
        tool_description = description or (
            fn.__doc__.strip().split("\n")[0] if fn.__doc__ else None
        )

        fn.__tool_metadata__ = ToolMetadata(  # type: ignore[attr-defined]
            name=tool_name,
            description=tool_description,
            schema=function_to_json_schema(fn),
            requires_confirmation=requires_confirmation,
            category=category,
        )

        return fn

    return decorator


def get_tool_metadata(fn: Callable) -> ToolMetadata | None:
    """Get the ToolMetadata from a decorated function."""
    return getattr(fn, "__tool_metadata__", None)


def is_tool(fn: Callable) -> bool:
    """Check if a function is decorated with @tool."""
    return hasattr(fn, "__tool_metadata__")
