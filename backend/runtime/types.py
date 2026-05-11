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
class ToolCallProgress(RuntimeEvent):
    tool_call_id: str = ""
    tool_name: str | None = None
    detail: str = ""
    kind: Literal["stdout", "stderr", "diff", "status", "other"] = "other"
    progress: float | None = None
    status: Literal["running", "completed", "failed"] | None = None


@dataclass(slots=True)
class WorkingStateChanged(RuntimeEvent):
    state: str = ""


@dataclass(slots=True)
class TokenUsage(RuntimeEvent):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    is_message_total: bool = False


@dataclass(slots=True)
class ApprovalOption:
    value: str
    label: str
    role: Literal["allow_once", "allow_session", "allow_always", "deny", "abort", "custom"]
    style: Literal["default", "primary", "destructive"] = "default"
    requires_input: bool = False


@dataclass(slots=True)
class ApprovalQuestion:
    index: int
    topic: str
    question: str
    options: list[str] = field(default_factory=list)
    placeholder: str | None = None
    multiline: bool = False
    required: bool = True


@dataclass(slots=True)
class ApprovalEditable:
    path: list[str]
    schema: dict[str, Any]
    label: str | None = None


@dataclass(slots=True)
class ApprovalAnswer:
    index: int
    answer: str


@dataclass(slots=True)
class ApprovalRequired(RuntimeEvent):
    kind: Literal["tool_approval", "user_input"] = "tool_approval"
    tool_use_ids: list[str] | None = None
    tool_name: str | None = None
    risk_level: Literal["low", "medium", "high", "unknown"] | None = None
    summary: str | None = None
    options: list[ApprovalOption] = field(default_factory=list)
    questions: list[ApprovalQuestion] = field(default_factory=list)
    editable: list[ApprovalEditable] = field(default_factory=list)
    renderer: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    timeout_ms: int | None = None


@dataclass(slots=True)
class ApprovalResolved(RuntimeEvent):
    selected_option: str = ""
    answers: list[ApprovalAnswer] = field(default_factory=list)
    edited_args: dict[str, Any] | None = None
    cancelled: bool = False


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
    | ToolCallProgress
    | WorkingStateChanged
    | TokenUsage
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
