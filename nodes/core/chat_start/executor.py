"""Chat Start node — bridge between the chat interface and the graph."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class ChatStartExecutor:
    node_type = "chat-start"

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
