from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    toolName: str
    toolArgs: dict[str, Any]
    toolResult: str | None = None
    isCompleted: bool | None = None
    providerData: dict[str, Any] | None = None


class RenderPlan(BaseModel):
    model_config = ConfigDict(extra="allow")
    renderer: str
    config: dict[str, Any] = Field(default_factory=dict)


class ToolCallPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    toolName: str
    toolArgs: dict[str, Any] = Field(default_factory=dict)
    toolResult: str | None = None
    isCompleted: bool | None = None
    providerData: dict[str, Any] | None = None
    renderPlan: RenderPlan | None = None
    requiresApproval: bool | None = None
    runId: str | None = None
    toolCallId: str | None = None
    approvalStatus: str | None = None
    editableArgs: list[str] | bool | None = None
    isDelegation: bool | None = None


class ContentBlock(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str
    content: str | list[ContentBlock] | None = None
    id: str | None = None
    toolName: str | None = None
    toolArgs: dict[str, Any] | None = None
    toolResult: str | None = None
    isCompleted: bool | None = None
    renderer: str | None = None
    requiresApproval: bool | None = None
    approvalId: str | None = None
    approvalStatus: str | None = None
    providerData: dict[str, Any] | None = None


class Attachment(BaseModel):
    id: str
    type: Literal["image", "file", "audio", "video"]
    name: str
    mimeType: str
    size: int


class ChatMessage(BaseModel):
    id: str
    role: str
    content: str | list[ContentBlock]
    createdAt: str | None = None
    toolCalls: list[ToolCall] | None = None
    attachments: list[Attachment] | None = None


class ChatData(BaseModel):
    id: str | None = None
    title: str
    messages: list[ChatMessage] = Field(default_factory=list)
    model: str | None = None
    createdAt: str | None = None
    updatedAt: str | None = None
    starred: bool = False


class AllChatsData(BaseModel):
    chats: dict[str, ChatData]


class AgentConfig(BaseModel):
    provider: str = "openai"
    modelId: str = "gpt-4o-mini"
    toolIds: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    name: str | None = None
    description: str | None = None


class CreateChatInput(BaseModel):
    id: str | None = None
    title: str | None = None
    model: str | None = None
    agentConfig: AgentConfig | None = None


class UpdateChatInput(BaseModel):
    id: str
    title: str | None = None
    model: str | None = None


class ChatId(BaseModel):
    id: str


class MessageId(BaseModel):
    id: str


class ExecutionEventItem(BaseModel):
    seq: int
    ts: str
    eventType: str
    nodeId: str | None = None
    nodeType: str | None = None
    runId: str | None = None
    payload: Any | None = None


class MessageExecutionTraceResponse(BaseModel):
    executionId: str | None = None
    kind: str | None = None
    status: str | None = None
    rootRunId: str | None = None
    startedAt: str | None = None
    endedAt: str | None = None
    events: list[ExecutionEventItem] = Field(default_factory=list)


class ChatStreamRequest(BaseModel):
    messages: list[ChatMessage]
    modelId: str
    chatId: str | None = None
    toolIds: list[str] = Field(default_factory=list)


class ChatEvent(BaseModel):
    event: str
    content: str | None = None
    reasoningContent: str | None = None
    sessionId: str | None = None
    tool: dict[str, Any] | None = None
    error: str | None = None
    blocks: list[dict[str, Any]] | None = None
    fileRenames: dict[str, str] | None = None
    memberName: str | None = None
    memberRunId: str | None = None
    task: str | None = None
    groupByNode: bool | None = None
    nodeId: str | None = None
    nodeType: str | None = None
    outputs: dict[str, Any] | None = None


class ToolApprovalResponse(BaseModel):
    approvalId: str
    approved: bool
    editedArgs: dict[str, Any] | None = None


class ToggleChatToolsInput(BaseModel):
    chatId: str
    toolIds: list[str]


class UpdateChatModelInput(BaseModel):
    chatId: str
    provider: str
    modelId: str


class ToolInfo(BaseModel):
    id: str
    name: str | None = None
    description: str | None = None
    toolsetId: str | None = None
    toolsetName: str | None = None
    inputSchema: dict[str, Any] | None = None
    renderer: str | None = None
    editable_args: list[str] | None = None
    requires_confirmation: bool | None = None


class MCPToolsetInfo(BaseModel):
    """Information about an MCP server (toolset)."""

    id: str  # e.g., "mcp:github"
    name: str  # e.g., "github"
    status: Literal["connecting", "connected", "error", "disconnected", "requires_auth"]
    error: str | None = None
    tools: list[ToolInfo] = Field(default_factory=list)


class AvailableToolsResponse(BaseModel):
    tools: list[ToolInfo] = Field(default_factory=list)


class OptionChoice(BaseModel):
    value: Any
    label: str


class ShowWhen(BaseModel):
    option: str
    values: list[Any] = Field(default_factory=list)


class OptionDefinition(BaseModel):
    key: str
    label: str
    type: Literal["select", "slider", "number", "boolean"]
    default: Any
    options: list[OptionChoice] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    showWhen: ShowWhen | None = None


class OptionSchema(BaseModel):
    main: list[OptionDefinition] = Field(default_factory=list)
    advanced: list[OptionDefinition] = Field(default_factory=list)


class ModelInfo(BaseModel):
    provider: str
    modelId: str
    displayName: str
    isDefault: bool = False
    options: OptionSchema | None = None


class ProviderConfig(BaseModel):
    provider: str
    apiKey: str | None = None
    baseUrl: str | None = None
    extra: Any | None = None
    enabled: bool = True


class SaveProviderConfigInput(BaseModel):
    provider: str
    apiKey: str | None = None
    baseUrl: str | None = None
    extra: Any | None = None
    enabled: bool = True


class AllProvidersResponse(BaseModel):
    providers: list[ProviderConfig]


class ProviderOAuthInfo(BaseModel):
    status: Literal["none", "pending", "authenticated", "error"]
    hasTokens: bool = False
    authUrl: str | None = None
    instructions: str | None = None
    error: str | None = None


class ProviderCatalogItem(BaseModel):
    key: str
    provider: str
    name: str
    description: str
    icon: str
    authType: Literal["apiKey", "oauth"] = "apiKey"
    defaultBaseUrl: str | None = None
    defaultEnabled: bool = True
    oauthVariant: Literal["panel", "compact", "inline-code", "device"] | None = None
    oauthEnterpriseDomain: bool = False
    fieldMode: Literal["standard_api_key", "openai_compatible", "local_ollama", "local_vllm"] | None = None
    aliases: list[str] = Field(default_factory=list)


class ProviderCatalogResponse(BaseModel):
    providers: list[ProviderCatalogItem]


class ProviderOverview(BaseModel):
    provider: str
    apiKey: str | None = None
    baseUrl: str | None = None
    extra: Any | None = None
    enabled: bool = True
    connected: bool = False
    oauth: ProviderOAuthInfo | None = None


class ProviderOverviewResponse(BaseModel):
    providers: list[ProviderOverview]


class ProviderPluginInfo(BaseModel):
    id: str
    name: str
    version: str
    provider: str
    enabled: bool = True
    blockedByPolicy: bool = False
    installedAt: str | None = None
    sourceType: str | None = None
    sourceRef: str | None = None
    sourceClass: Literal["official", "community"] = "community"
    indexId: str | None = None
    repoUrl: str | None = None
    trackingRef: str | None = None
    pluginPath: str | None = None
    autoUpdateOverride: Literal["inherit", "enabled", "disabled"] = "inherit"
    effectiveAutoUpdate: bool = False
    description: str
    icon: str
    authType: Literal["apiKey", "oauth"] = "apiKey"
    defaultBaseUrl: str | None = None
    defaultEnabled: bool = True
    oauthVariant: Literal["panel", "compact", "inline-code", "device"] | None = None
    oauthEnterpriseDomain: bool = False
    aliases: list[str] = Field(default_factory=list)
    verificationStatus: Literal["verified", "untrusted", "unsigned", "invalid"] = "unsigned"
    verificationMessage: str | None = None
    signingKeyId: str | None = None
    updateError: str | None = None
    error: str | None = None


class ProviderPluginsResponse(BaseModel):
    plugins: list[ProviderPluginInfo]


class ProviderPluginSourceInfo(BaseModel):
    id: str
    pluginId: str
    name: str
    version: str
    provider: str
    description: str
    icon: str
    sourceClass: Literal["official", "community"] = "community"
    indexId: str | None = None
    indexName: str | None = None
    sourceUrl: str | None = None
    repoUrl: str | None = None
    trackingRef: str | None = None
    pluginPath: str | None = None
    blockedByPolicy: bool = False
    installed: bool = False


class ProviderPluginSourcesResponse(BaseModel):
    sources: list[ProviderPluginSourceInfo]


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
    indexes: list[ProviderPluginIndexInfo]


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
    ref: str | None = "main"
    pluginPath: str | None = None


class SetProviderPluginAutoUpdateInput(BaseModel):
    id: str
    override: Literal["inherit", "enabled", "disabled"] = "inherit"
    trackingRef: str | None = None


class ProviderPluginUpdateItem(BaseModel):
    id: str
    status: Literal["updated", "skipped", "failed"]
    message: str | None = None


class ProviderPluginUpdateCheckResponse(BaseModel):
    results: list[ProviderPluginUpdateItem] = Field(default_factory=list)
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
    verificationMessage: str | None = None
    signingKeyId: str | None = None


class DefaultToolsResponse(BaseModel):
    toolIds: list[str]


class SetDefaultToolsInput(BaseModel):
    toolIds: list[str]


class ChatAgentConfigResponse(BaseModel):
    toolIds: list[str]
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
    thinkingTagPrompted: ThinkingTagPromptInfo | None = None


class AllModelSettingsResponse(BaseModel):
    models: list[ModelSettingsInfo]


class SaveModelSettingsInput(BaseModel):
    provider: str
    modelId: str
    parseThinkTags: bool = False
    reasoning: ReasoningInfo | None = None
