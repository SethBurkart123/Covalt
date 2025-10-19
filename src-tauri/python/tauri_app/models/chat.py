from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import Field

from ..types import _BaseModel


class ToolCall(_BaseModel):
    id: str
    toolName: str
    toolArgs: Dict[str, Any]
    toolResult: Optional[str] = None
    isCompleted: Optional[bool] = None


class ChatMessage(_BaseModel):
    id: str
    role: str
    content: str
    createdAt: Optional[str] = None
    toolCalls: Optional[List[ToolCall]] = None


class ChatData(_BaseModel):
    id: Optional[str] = None
    title: str
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class AllChatsData(_BaseModel):
    chats: Dict[str, ChatData]


class AgentConfig(_BaseModel):
    provider: str = "openai"
    modelId: str = "gpt-4o-mini"
    toolIds: List[str] = Field(default_factory=list)
    instructions: List[str] = Field(default_factory=list)
    name: Optional[str] = None
    description: Optional[str] = None


class CreateChatInput(_BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    model: Optional[str] = None
    agentConfig: Optional[AgentConfig] = None


class UpdateChatInput(_BaseModel):
    id: str
    title: Optional[str] = None
    model: Optional[str] = None


class ChatId(_BaseModel):
    id: str


class ChatStreamRequest(_BaseModel):
    messages: List[ChatMessage]
    modelId: str
    chatId: Optional[str] = None


class ChatEvent(_BaseModel):
    # Discriminator field for event name
    event: str
    # Optional fields
    content: Optional[str] = None
    reasoningContent: Optional[str] = None
    sessionId: Optional[str] = None
    tool: Optional[Dict[str, Any]] = None


class ToggleChatToolsInput(_BaseModel):
    chatId: str
    toolIds: List[str]


class UpdateChatModelInput(_BaseModel):
    chatId: str
    provider: str
    modelId: str


class ToolInfo(_BaseModel):
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None


class AvailableToolsResponse(_BaseModel):
    tools: List[ToolInfo]


class ModelInfo(_BaseModel):
    provider: str
    modelId: str
    displayName: str
    isDefault: bool = False


class AvailableModelsResponse(_BaseModel):
    models: List[ModelInfo]


class ProviderConfig(_BaseModel):
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    enabled: bool = True


class SaveProviderConfigInput(_BaseModel):
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    enabled: bool = True


class AllProvidersResponse(_BaseModel):
    providers: List[ProviderConfig]


class DefaultToolsResponse(_BaseModel):
    tool_ids: List[str]


class SetDefaultToolsInput(_BaseModel):
    tool_ids: List[str]

