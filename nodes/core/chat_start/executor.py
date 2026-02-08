"""Chat Start node — bridge between the chat interface and the graph."""

from __future__ import annotations
from typing import Any
from nodes._types import MetadataResult, BuildContext


class ChatStartExecutor:
    node_type = "chat-start"

    def build(self, data: dict[str, Any], context: BuildContext) -> MetadataResult:
        return MetadataResult(
            metadata={
                "includeUserTools": bool(data.get("includeUserTools", False)),
            }
        )


executor = ChatStartExecutor()
