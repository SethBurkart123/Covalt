from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class ToolCall(BaseModel):
    id: str
    toolName: str
    toolArgs: Dict[str, Any]
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None


class ContentBlock(BaseModel):
    # Allow extra fields on content blocks so we can attach
    # metadata like timestamps or tracebacks to error blocks
    model_config = ConfigDict(extra="allow")
    type: str  # "text", "tool_call", "reasoning"
    # For text blocks
    content: Optional[str] = None
    # For tool_call blocks
    id: Optional[str] = None
    toolName: Optional[str] = None
    toolArgs: Optional[Dict[str, Any]] = None
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None
    renderer: Optional[str] = None
    # For tool approval
    requiresApproval: Optional[bool] = None
    approvalId: Optional[str] = None
    approvalStatus: Optional[str] = None  # "pending", "approved", "denied"


class ChatMessage(BaseModel):
    id: str
    role: str
    content: Union[str, List[ContentBlock]]  # Support both formats
    createdAt: Optional[str] = None
    toolCalls: Optional[List[ToolCall]] = None  # Deprecated, for migration


class ChatData(BaseModel):
    id: Optional[str] = None
    title: str
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class AllChatsData(BaseModel):
    chats: Dict[str, ChatData]


class AgentConfig(BaseModel):
    provider: str = "openai"
    modelId: str = "gpt-4o-mini"
    toolIds: List[str] = Field(default_factory=list)
    instructions: List[str] = Field(default_factory=list)
    name: Optional[str] = None
    description: Optional[str] = None


class CreateChatInput(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    model: Optional[str] = None
    agentConfig: Optional[AgentConfig] = None


class UpdateChatInput(BaseModel):
    id: str
    title: Optional[str] = None
    model: Optional[str] = None


class ChatId(BaseModel):
    id: str


class ChatStreamRequest(BaseModel):
    messages: List[ChatMessage]
    modelId: str
    chatId: Optional[str] = None


class ChatEvent(BaseModel):
    # Discriminator field for event name
    event: str
    # Optional fields
    content: Optional[str] = None
    reasoningContent: Optional[str] = None
    sessionId: Optional[str] = None
    tool: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    # For seeding existing content blocks on continuation
    blocks: Optional[List[Dict[str, Any]]] = None


class ToolApprovalResponse(BaseModel):
    approvalId: str
    approved: bool
    editedArgs: Optional[Dict[str, Any]] = None


class ToggleChatToolsInput(BaseModel):
    chatId: str
    toolIds: List[str]


class UpdateChatModelInput(BaseModel):
    chatId: str
    provider: str
    modelId: str


class ToolInfo(BaseModel):
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    # Additional fields for MCP tools
    inputSchema: Optional[Dict[str, Any]] = None
    renderer: Optional[str] = None
    editable_args: Optional[List[str]] = None
    requires_confirmation: Optional[bool] = None


class MCPToolsetInfo(BaseModel):
    """Information about an MCP server (toolset)."""

    id: str  # e.g., "mcp:github"
    name: str  # e.g., "github"
    status: Literal["connecting", "connected", "error", "disconnected"]
    error: Optional[str] = None
    tools: List[ToolInfo] = Field(default_factory=list)


class AvailableToolsResponse(BaseModel):
    tools: List[ToolInfo] = Field(default_factory=list)

class ModelInfo(BaseModel):
    provider: str
    modelId: str
    displayName: str
    isDefault: bool = False


class AvailableModelsResponse(BaseModel):
    models: List[ModelInfo]


class ProviderConfig(BaseModel):
    provider: str
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    extra: Optional[Any] = None
    enabled: bool = True


class SaveProviderConfigInput(BaseModel):
    provider: str
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    extra: Optional[Any] = None
    enabled: bool = True


class AllProvidersResponse(BaseModel):
    providers: List[ProviderConfig]


class DefaultToolsResponse(BaseModel):
    toolIds: List[str]


class SetDefaultToolsInput(BaseModel):
    toolIds: List[str]


class ChatAgentConfigResponse(BaseModel):
    toolIds: List[str]
    provider: str
    modelId: str


class AutoTitleSettings(BaseModel):
    enabled: bool = True
    prompt: str = "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else."
    modelMode: str = "current"  # "current" or "specific"
    provider: str = "openai"
    modelId: str = "gpt-4o-mini"


class SaveAutoTitleSettingsInput(BaseModel):
    enabled: bool
    prompt: str
    modelMode: str
    provider: str
    modelId: str


class ReasoningInfo(BaseModel):
    supports: bool
    isUserOverride: bool


class ThinkingTagPromptInfo(BaseModel):
    prompted: bool
    declined: bool


class ModelSettingsInfo(BaseModel):
    provider: str
    modelId: str
    parseThinkTags: bool
    reasoning: ReasoningInfo
    thinkingTagPrompted: Optional[ThinkingTagPromptInfo] = None


class AllModelSettingsResponse(BaseModel):
    models: List[ModelSettingsInfo]


class SaveModelSettingsInput(BaseModel):
    provider: str
    modelId: str
    parseThinkTags: bool = False
    reasoning: Optional[ReasoningInfo] = None
