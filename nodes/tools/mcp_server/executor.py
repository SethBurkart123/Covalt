"""MCP Server node — resolves tools from an MCP server."""

from __future__ import annotations
from typing import Any
from nodes._types import ToolsResult, BuildContext


class McpServerExecutor:
    node_type = "mcp-server"

    def build(self, data: dict[str, Any], context: BuildContext) -> ToolsResult:
        server_id = data.get("server")
        if not server_id:
            return ToolsResult(tools=[])
        tools = context.tool_registry.resolve_tool_ids(
            [f"mcp:{server_id}"],
            chat_id=context.chat_id,
        )
        return ToolsResult(tools=tools)


executor = McpServerExecutor()
