from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    toolName: str
    toolArgs: Dict[str, Any]
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None
    providerData: Optional[Dict[str, Any]] = None


class RenderPlan(BaseModel):
    model_config = ConfigDict(extra="allow")
    renderer: str
    config: Dict[str, Any] = Field(default_factory=dict)


class ToolCallPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    toolName: str
    toolArgs: Dict[str, Any] = Field(default_factory=dict)
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None
    providerData: Optional[Dict[str, Any]] = None
    renderPlan: Optional[RenderPlan] = None
    requiresApproval: Optional[bool] = None
    runId: Optional[str] = None
    toolCallId: Optional[str] = None
    approvalStatus: Optional[str] = None
    editableArgs: Optional[Union[List[str], bool]] = None
    isDelegation: Optional[bool] = None


class ContentBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str
    content: Optional[Union[str, List["ContentBlock"]]] = None
    id: Optional[str] = None
    toolName: Optional[str] = None
    toolArgs: Optional[Dict[str, Any]] = None
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None
    renderer: Optional[str] = None
    requiresApproval: Optional[bool] = None
    approvalId: Optional[str] = None
    approvalStatus: Optional[str] = None
    providerData: Optional[Dict[str, Any]] = None


class Attachment(BaseModel):
    id: str
    type: Literal["image", "file", "audio", "video"]
    name: str
    mimeType: str
    size: int


class ChatMessage(BaseModel):
    id: str
    role: str
    content: Union[str, List[ContentBlock]]
    createdAt: Optional[str] = None
    toolCalls: Optional[List[ToolCall]] = None
    attachments: Optional[List[Attachment]] = None


class ChatData(BaseModel):
    id: Optional[str] = None
    title: str
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    starred: bool = False


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


class MessageId(BaseModel):
    id: str


class ExecutionEventItem(BaseModel):
    seq: int
    ts: str
    eventType: str
    nodeId: Optional[str] = None
    nodeType: Optional[str] = None
    runId: Optional[str] = None
    payload: Optional[Any] = None


class MessageExecutionTraceResponse(BaseModel):
    executionId: Optional[str] = None
    kind: Optional[str] = None
    status: Optional[str] = None
    rootRunId: Optional[str] = None
    startedAt: Optional[str] = None
    endedAt: Optional[str] = None
    events: List[ExecutionEventItem] = Field(default_factory=list)


class ChatStreamRequest(BaseModel):
    messages: List[ChatMessage]
    modelId: str
    chatId: Optional[str] = None
    toolIds: List[str] = Field(default_factory=list)


class ChatEvent(BaseModel):
    event: str
    content: Optional[str] = None
    reasoningContent: Optional[str] = None
    sessionId: Optional[str] = None
    tool: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    blocks: Optional[List[Dict[str, Any]]] = None
    fileRenames: Optional[Dict[str, str]] = None
    memberName: Optional[str] = None
    memberRunId: Optional[str] = None
    task: Optional[str] = None
    groupByNode: Optional[bool] = None
    nodeId: Optional[str] = None
    nodeType: Optional[str] = None
    outputs: Optional[Dict[str, Any]] = None


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
    toolsetId: Optional[str] = None
    toolsetName: Optional[str] = None
    inputSchema: Optional[Dict[str, Any]] = None
    renderer: Optional[str] = None
    editable_args: Optional[List[str]] = None
    requires_confirmation: Optional[bool] = None


class MCPToolsetInfo(BaseModel):
    """Information about an MCP server (toolset)."""

    id: str  # e.g., "mcp:github"
    name: str  # e.g., "github"
    status: Literal["connecting", "connected", "error", "disconnected", "requires_auth"]
    error: Optional[str] = None
    tools: List[ToolInfo] = Field(default_factory=list)


class AvailableToolsResponse(BaseModel):
    tools: List[ToolInfo] = Field(default_factory=list)


class OptionChoice(BaseModel):
    value: Any
    label: str


class ShowWhen(BaseModel):
    option: str
    values: List[Any] = Field(default_factory=list)


class OptionDefinition(BaseModel):
    key: str
    label: str
    type: Literal["select", "slider", "number", "boolean"]
    default: Any
    options: Optional[List[OptionChoice]] = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    showWhen: Optional[ShowWhen] = None


class OptionSchema(BaseModel):
    main: List[OptionDefinition] = Field(default_factory=list)
    advanced: List[OptionDefinition] = Field(default_factory=list)


class ModelInfo(BaseModel):
    provider: str
    modelId: str
    displayName: str
    isDefault: bool = False
    options: Optional[OptionSchema] = None


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


class ProviderOAuthInfo(BaseModel):
    status: Literal["none", "pending", "authenticated", "error"]
    hasTokens: bool = False
    authUrl: Optional[str] = None
    instructions: Optional[str] = None
    error: Optional[str] = None


class ProviderCatalogItem(BaseModel):
    key: str
    provider: str
    name: str
    description: str
    icon: str
    authType: Literal["apiKey", "oauth"] = "apiKey"
    defaultBaseUrl: Optional[str] = None
    defaultEnabled: bool = True
    oauthVariant: Optional[Literal["panel", "compact", "inline-code", "device"]] = None
    oauthEnterpriseDomain: bool = False
    fieldMode: Optional[
        Literal["standard_api_key", "openai_compatible", "local_ollama", "local_vllm"]
    ] = None
    aliases: List[str] = Field(default_factory=list)


class ProviderCatalogResponse(BaseModel):
    providers: List[ProviderCatalogItem]


class ProviderOverview(BaseModel):
    provider: str
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    extra: Optional[Any] = None
    enabled: bool = True
    connected: bool = False
    oauth: Optional[ProviderOAuthInfo] = None


class ProviderOverviewResponse(BaseModel):
    providers: List[ProviderOverview]


class ProviderPluginInfo(BaseModel):
    id: str
    name: str
    version: str
    provider: str
    enabled: bool = True
    blockedByPolicy: bool = False
    installedAt: Optional[str] = None
    sourceType: Optional[str] = None
    sourceRef: Optional[str] = None
    sourceClass: Literal["official", "community"] = "community"
    indexId: Optional[str] = None
    repoUrl: Optional[str] = None
    trackingRef: Optional[str] = None
    pluginPath: Optional[str] = None
    autoUpdateOverride: Literal["inherit", "enabled", "disabled"] = "inherit"
    effectiveAutoUpdate: bool = False
    description: str
    icon: str
    authType: Literal["apiKey", "oauth"] = "apiKey"
    defaultBaseUrl: Optional[str] = None
    defaultEnabled: bool = True
    oauthVariant: Optional[Literal["panel", "compact", "inline-code", "device"]] = None
    oauthEnterpriseDomain: bool = False
    aliases: List[str] = Field(default_factory=list)
    verificationStatus: Literal["verified", "untrusted", "unsigned", "invalid"] = "unsigned"
    verificationMessage: Optional[str] = None
    signingKeyId: Optional[str] = None
    updateError: Optional[str] = None
    error: Optional[str] = None


class ProviderPluginsResponse(BaseModel):
    plugins: List[ProviderPluginInfo]


class ProviderPluginSourceInfo(BaseModel):
    id: str
    pluginId: str
    name: str
    version: str
    provider: str
    description: str
    icon: str
    sourceClass: Literal["official", "community"] = "community"
    indexId: Optional[str] = None
    indexName: Optional[str] = None
    sourceUrl: Optional[str] = None
    repoUrl: Optional[str] = None
    trackingRef: Optional[str] = None
    pluginPath: Optional[str] = None
    blockedByPolicy: bool = False
    installed: bool = False


class ProviderPluginSourcesResponse(BaseModel):
    sources: List[ProviderPluginSourceInfo]


class ProviderPluginPolicy(BaseModel):
    mode: Literal["safe", "unsafe"] = "safe"
    autoUpdateEnabled: bool = False


class SaveProviderPluginPolicyInput(BaseModel):
    mode: Literal["safe", "unsafe"]
    autoUpdateEnabled: bool


class ProviderPluginIndexInfo(BaseModel):
    id: str
    name: str
    url: str
    sourceClass: Literal["official", "community"] = "community"
    builtIn: bool = False
    pluginCount: int = 0


class ProviderPluginIndexesResponse(BaseModel):
    indexes: List[ProviderPluginIndexInfo]


class AddProviderPluginIndexInput(BaseModel):
    name: str
    url: str


class RemoveProviderPluginIndexInput(BaseModel):
    id: str


class RefreshProviderPluginIndexInput(BaseModel):
    id: str


class InstallProviderPluginSourceInput(BaseModel):
    id: str


class InstallProviderPluginFromRepoInput(BaseModel):
    repoUrl: str
    ref: Optional[str] = "main"
    pluginPath: Optional[str] = None


class SetProviderPluginAutoUpdateInput(BaseModel):
    id: str
    override: Literal["inherit", "enabled", "disabled"] = "inherit"
    trackingRef: Optional[str] = None


class ProviderPluginUpdateItem(BaseModel):
    id: str
    status: Literal["updated", "skipped", "failed"]
    message: Optional[str] = None


class ProviderPluginUpdateCheckResponse(BaseModel):
    results: List[ProviderPluginUpdateItem] = Field(default_factory=list)
    updated: int = 0
    skipped: int = 0
    failed: int = 0


class EnableProviderPluginInput(BaseModel):
    id: str
    enabled: bool


class ProviderPluginIdInput(BaseModel):
    id: str


class ImportProviderPluginResponse(BaseModel):
    id: str
    provider: str
    name: str
    version: str
    verificationStatus: Literal["verified", "untrusted", "unsigned", "invalid"] = "unsigned"
    verificationMessage: Optional[str] = None
    signingKeyId: Optional[str] = None


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
    modelMode: str = "current"
    provider: str = "openai"
    modelId: str = "gpt-4o-mini"


class SaveAutoTitleSettingsInput(BaseModel):
    enabled: bool
    prompt: str
    modelMode: str
    provider: str
    modelId: str


class SystemPromptSettings(BaseModel):
    prompt: str = ""


class SaveSystemPromptSettingsInput(BaseModel):
    prompt: str


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
