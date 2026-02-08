"""Toolset node — resolves tools from a registered toolset."""

from __future__ import annotations
from typing import Any
from nodes._types import ToolsResult, BuildContext


class ToolsetExecutor:
    node_type = "toolset"

    def build(self, data: dict[str, Any], context: BuildContext) -> ToolsResult:
        toolset_id = data.get("toolset")
        if not toolset_id:
            return ToolsResult(tools=[])
        tools = context.tool_registry.resolve_tool_ids(
            [f"toolset:{toolset_id}"],
            chat_id=context.chat_id,
        )
        return ToolsResult(tools=tools)


executor = ToolsetExecutor()
