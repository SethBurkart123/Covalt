"""
Agno Toolset SDK - Build tools for Agno.

This package provides the core utilities for building toolsets:
- @tool decorator for defining tools with automatic schema inference
- get_context() for accessing workspace, chat_id, etc. during execution
- Pydantic model support for complex parameter types

Quick Start:
    from agno_toolset import tool, get_context

    @tool(name="Write File", description="Write content to a file")
    def write_file(path: str, content: str) -> dict:
        ctx = get_context()
        target = ctx.workspace / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return {"path": path, "size": len(content)}

With Pydantic:
    from pydantic import BaseModel, Field
    from agno_toolset import tool

    class Item(BaseModel):
        name: str = Field(description="Item name")
        quantity: int = Field(ge=1, description="Quantity")

    @tool(name="Add Items")
    def add_items(items: list[Item]) -> dict:
        return {"added": len(items)}
"""

from .context import ToolContext, clear_context, get_context, set_context
from .decorator import ToolMetadata, get_tool_metadata, is_tool, tool
from .schema import function_to_json_schema, type_to_json_schema

__all__ = [
    # Core API
    "tool",
    "get_context",
    "ToolContext",
    # Advanced
    "ToolMetadata",
    "get_tool_metadata",
    "is_tool",
    "set_context",
    "clear_context",
    # Schema utilities
    "function_to_json_schema",
    "type_to_json_schema",
]

__version__ = "0.1.0"
