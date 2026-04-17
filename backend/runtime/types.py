from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


@dataclass(slots=True)
class RuntimeAttachment:
    kind: Literal["image", "file", "audio", "video"]
    path: Path
    name: str | None = None


@dataclass(slots=True)
class RuntimeToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    provider_data: dict[str, Any] | None = None


@dataclass(slots=True)
class RuntimeMessage:
    role: Literal["user", "assistant", "tool"]
    content: str | None = None
    attachments: list[RuntimeAttachment] = field(default_factory=list)
    tool_calls: list[RuntimeToolCall] = field(default_factory=list)
    tool_call_id: str | None = None


@dataclass(slots=True)
class RuntimeToolResult:
    id: str
    name: str
    result: str | None = None
    error: str | None = None
    provider_data: dict[str, Any] | None = None
    failed: bool = False


@dataclass(slots=True)
class PendingApproval:
    tool_call_id: str
    tool_name: str
    tool_args: dict[str, Any] = field(default_factory=dict)
    editable_args: list[str] | bool | None = None
    requires_user_input: bool = False
    user_input_schema: list[dict[str, Any]] | None = None


@dataclass(slots=True)
class ToolDecision:
    approved: bool
    edited_args: dict[str, Any] | None = None
    user_input: dict[str, Any] | None = None


@dataclass(slots=True)
class ApprovalResponse:
    run_id: str
    decisions: dict[str, ToolDecision] = field(default_factory=dict)
    default_approved: bool = False
    cancelled: bool = False


@dataclass(slots=True)
class RuntimeEvent:
    run_id: str | None = None
    member_run_id: str | None = None
    member_name: str | None = None
    task: str | None = None


@dataclass(slots=True)
class RunStarted(RuntimeEvent):
    pass


@dataclass(slots=True)
class ContentDelta(RuntimeEvent):
    text: str = ""


@dataclass(slots=True)
class ReasoningStarted(RuntimeEvent):
    pass


@dataclass(slots=True)
class ReasoningDelta(RuntimeEvent):
    text: str = ""


@dataclass(slots=True)
class ReasoningCompleted(RuntimeEvent):
    pass


@dataclass(slots=True)
class ToolCallStarted(RuntimeEvent):
    tool: RuntimeToolCall | None = None


@dataclass(slots=True)
class ToolCallCompleted(RuntimeEvent):
    tool: RuntimeToolResult | None = None


@dataclass(slots=True)
class ApprovalRequired(RuntimeEvent):
    tools: list[PendingApproval] = field(default_factory=list)


@dataclass(slots=True)
class ApprovalResolved(RuntimeEvent):
    tool_call_id: str = ""
    tool_name: str = ""
    approval_status: Literal["approved", "denied", "timeout"] = "approved"
    tool_args: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ModelUsage(RuntimeEvent):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    time_to_first_token: float | None = None
    model: str | None = None
    provider: str | None = None


@dataclass(slots=True)
class RunCompleted(RuntimeEvent):
    content: str | None = None


@dataclass(slots=True)
class RunCancelled(RuntimeEvent):
    pass


@dataclass(slots=True)
class RunError(RuntimeEvent):
    message: str = ""


RuntimeEventT = (
    RunStarted
    | ContentDelta
    | ReasoningStarted
    | ReasoningDelta
    | ReasoningCompleted
    | ToolCallStarted
    | ToolCallCompleted
    | ApprovalRequired
    | ApprovalResolved
    | ModelUsage
    | RunCompleted
    | RunCancelled
    | RunError
)


@dataclass(slots=True)
class AgentConfig:
    model: Any
    tools: list[Any] = field(default_factory=list)
    instructions: list[str] = field(default_factory=list)
    name: str = "Agent"
    description: str = ""
