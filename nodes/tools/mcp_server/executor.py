"""MCP Server node — resolves tools from an MCP server."""

from __future__ import annotations
from typing import Any

from nodes._types import FlowContext


class McpServerExecutor:
    node_type = "mcp-server"

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> list[Any]:
        if output_handle != "tools":
            raise ValueError(
                f"mcp-server node cannot materialize unknown output handle: {output_handle}"
            )

        server_id = data.get("server")
        if not server_id:
            return []

        return context.tool_registry.resolve_tool_ids(
            [f"mcp:{server_id}"],
            chat_id=context.chat_id,
        )


executor = McpServerExecutor()
