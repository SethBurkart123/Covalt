from .agno import AgnoRuntimeAdapter
from .chat_conversion import (
    runtime_message_from_chat_message,
    runtime_message_to_dict,
    runtime_messages_from_chat_messages,
)
from .protocol import AgentHandle, RuntimeAdapter
from .types import (
    AgentConfig,
    ApprovalRequired,
    ApprovalResolved,
    ApprovalResponse,
    ContentDelta,
    ModelUsage,
    PendingApproval,
    ReasoningCompleted,
    ReasoningDelta,
    ReasoningStarted,
    RunCancelled,
    RunCompleted,
    RunError,
    RunStarted,
    RuntimeAttachment,
    RuntimeEvent,
    RuntimeEventT,
    RuntimeMessage,
    RuntimeToolCall,
    RuntimeToolResult,
    ToolCallCompleted,
    ToolCallStarted,
    ToolDecision,
)

_RUNTIME_ADAPTER: RuntimeAdapter = AgnoRuntimeAdapter()


def get_adapter() -> RuntimeAdapter:
    return _RUNTIME_ADAPTER


__all__ = [
    "AgentConfig",
    "AgentHandle",
    "get_adapter",
    "runtime_message_from_chat_message",
    "runtime_message_to_dict",
    "runtime_messages_from_chat_messages",
    "ApprovalRequired",
    "ApprovalResolved",
    "ApprovalResponse",
    "ContentDelta",
    "ModelUsage",
    "PendingApproval",
    "ReasoningCompleted",
    "ReasoningDelta",
    "ReasoningStarted",
    "RunCancelled",
    "RunCompleted",
    "RunError",
    "RunStarted",
    "RuntimeAdapter",
    "RuntimeAttachment",
    "RuntimeEvent",
    "RuntimeEventT",
    "RuntimeMessage",
    "RuntimeToolCall",
    "RuntimeToolResult",
    "ToolCallCompleted",
    "ToolCallStarted",
    "ToolDecision",
]
