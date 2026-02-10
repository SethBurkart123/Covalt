"""Chat Start node — bridge between the chat interface and the graph.

Hybrid executor:
  build()   → Phase 1: provide metadata (includeUserTools)
  execute() → Phase 2: emit user message into the flow as the entry point
"""

from __future__ import annotations

from typing import Any

from nodes._types import (
    BuildContext,
    DataValue,
    ExecutionResult,
    FlowContext,
    MetadataResult,
)


class ChatStartExecutor:
    node_type = "chat-start"

    def build(self, data: dict[str, Any], context: BuildContext) -> MetadataResult:
        return MetadataResult(
            metadata={
                "includeUserTools": bool(data.get("includeUserTools", False)),
            }
        )

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        user_message = ""
        if context.state is not None:
            user_message = getattr(context.state, "user_message", "") or ""
            if not user_message and isinstance(context.state, dict):
                user_message = context.state.get("user_message", "")

        return ExecutionResult(
            outputs={"output": DataValue(type="data", value={"message": user_message})}
        )


executor = ChatStartExecutor()
