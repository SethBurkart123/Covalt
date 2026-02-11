"""Toolset node — resolves tools from a registered toolset."""

from __future__ import annotations
from typing import Any

from nodes._types import FlowContext


class ToolsetExecutor:
    node_type = "toolset"

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
                f"toolset node cannot materialize unknown output handle: {output_handle}"
            )

        toolset_id = data.get("toolset")
        if not toolset_id:
            return []

        tool_registry = self._get_tool_registry(context)
        if tool_registry is None:
            raise ValueError("toolset node requires tool_registry in context.services")

        return tool_registry.resolve_tool_ids(
            [f"toolset:{toolset_id}"],
            chat_id=context.chat_id,
        )


executor = ToolsetExecutor()
