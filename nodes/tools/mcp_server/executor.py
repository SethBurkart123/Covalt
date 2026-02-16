"""MCP Server node — resolves tools from an MCP server."""

from __future__ import annotations
from typing import Any

from nodes._types import FlowContext


class McpServerExecutor:
    node_type = "mcp-server"

    def _tag_tools(self, tools: list[Any], context: FlowContext) -> list[Any]:
        tagged: list[Any] = []
        for tool in tools:
            if tool is None:
                continue
            try:
                setattr(tool, "__agno_node_id", context.node_id)
                setattr(tool, "__agno_node_type", self.node_type)
            except Exception:
                pass
            tagged.append(tool)
        return tagged

    def _get_tool_registry(self, context: FlowContext) -> Any | None:
        services = context.services
        if services is None:
            return None
        return getattr(services, "tool_registry", None)

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

        tool_registry = self._get_tool_registry(context)
        if tool_registry is None:
            raise ValueError(
                "mcp-server node requires tool_registry in context.services"
            )

        tools = tool_registry.resolve_tool_ids(
            [f"mcp:{server_id}"],
            chat_id=context.chat_id,
        )
        return self._tag_tools(tools, context)


executor = McpServerExecutor()
