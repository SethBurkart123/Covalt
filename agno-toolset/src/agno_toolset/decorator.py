"""
@tool decorator for defining toolset tools.

The decorator captures metadata and enables automatic JSON Schema inference
from type hints.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .schema import function_to_json_schema


@dataclass
class ToolMetadata:
    """
    Metadata extracted from a @tool decorated function.

    This is attached to the function as __tool_metadata__ and read by
    the toolset executor when loading tools.
    """

    name: str
    """Display name of the tool."""

    description: str | None
    """Description shown to the LLM."""

    schema: dict[str, Any]
    """JSON Schema for the tool's parameters."""

    requires_confirmation: bool
    """Whether the tool requires user confirmation before execution."""

    category: str | None
    """Optional category for grouping tools."""


def tool(
    name: str | None = None,
    description: str | None = None,
    requires_confirmation: bool = False,
    category: str | None = None,
) -> Callable[[Callable], Callable]:
    """
    Decorator to mark a function as a toolset tool.

    The decorator:
    1. Captures metadata (name, description, etc.)
    2. Infers JSON Schema from type hints
    3. Attaches metadata to the function as __tool_metadata__

    Args:
        name: Display name for the tool. Defaults to the function name.
        description: Description shown to the LLM. Defaults to the function's docstring.
        requires_confirmation: If True, user must confirm before tool runs.
        category: Optional category for grouping (e.g., "content", "utility").

    Returns:
        Decorator function.

    Example:
        from agno_toolset import tool, get_context

        @tool(name="Write File", description="Write content to a file")
        def write_file(path: str, content: str) -> dict:
            ctx = get_context()
            (ctx.workspace / path).write_text(content)
            return {"path": path, "size": len(content)}

    Example with Pydantic:
        from pydantic import BaseModel, Field
        from agno_toolset import tool

        class Question(BaseModel):
            text: str = Field(description="The question text")
            answers: list[str] = Field(min_length=4, max_length=4)
            correct_index: int = Field(ge=0, le=3)

        @tool(name="Create Quiz")
        def create_quiz(title: str, questions: list[Question]) -> dict:
            return {"title": title, "questions": [q.model_dump() for q in questions]}
    """

    def decorator(fn: Callable) -> Callable:
        # Extract or default metadata
        tool_name = name or fn.__name__
        tool_description = description or (
            fn.__doc__.strip().split("\n")[0] if fn.__doc__ else None
        )

        # Generate JSON Schema from type hints
        schema = function_to_json_schema(fn)

        # Attach metadata to the function
        fn.__tool_metadata__ = ToolMetadata(  # type: ignore[attr-defined]
            name=tool_name,
            description=tool_description,
            schema=schema,
            requires_confirmation=requires_confirmation,
            category=category,
        )

        return fn

    return decorator


def get_tool_metadata(fn: Callable) -> ToolMetadata | None:
    """
    Get the ToolMetadata from a decorated function.

    Args:
        fn: A function that may have been decorated with @tool.

    Returns:
        The ToolMetadata if the function was decorated, None otherwise.
    """
    return getattr(fn, "__tool_metadata__", None)


def is_tool(fn: Callable) -> bool:
    """
    Check if a function is decorated with @tool.

    Args:
        fn: A function to check.

    Returns:
        True if the function has @tool decorator metadata.
    """
    return hasattr(fn, "__tool_metadata__")
