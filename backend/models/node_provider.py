
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class NodeProviderPluginInfo(BaseModel):
    id: str
    name: str
    version: str
    enabled: bool = True
    installedAt: str | None = None
    sourceType: str | None = None
    sourceRef: str | None = None
    repoUrl: str | None = None
    trackingRef: str | None = None
    pluginPath: str | None = None
    error: str | None = None


class NodeProviderPluginsResponse(BaseModel):
    plugins: list[NodeProviderPluginInfo] = Field(default_factory=list)


class InstallNodeProviderPluginFromRepoInput(BaseModel):
    repoUrl: str
    ref: str | None = 'main'
    pluginPath: str | None = None


class InstallNodeProviderPluginFromDirectoryInput(BaseModel):
    path: str


class EnableNodeProviderPluginInput(BaseModel):
    id: str
    enabled: bool


class NodeProviderPluginIdInput(BaseModel):
    id: str


class NodeProviderCapabilityFlags(BaseModel):
    execute: bool = True
    materialize: bool = False
    configureRuntime: bool = False
    routes: bool = False


class NodeProviderRouteEntry(BaseModel):
    path: str
    methods: list[str] = Field(default_factory=lambda: ['POST'])
    mode: Literal['trigger', 'proxy'] = 'trigger'


class NodeProviderRouteConfig(BaseModel):
    idField: Literal['routeId', 'hookId'] = 'routeId'
    entries: list[NodeProviderRouteEntry] = Field(default_factory=list)


class NodeProviderNodeDefinition(BaseModel):
    type: str
    name: str
    description: str | None = None
    category: Literal['trigger', 'llm', 'tools', 'flow', 'data', 'integration', 'rag', 'utility']
    icon: str
    executionMode: Literal['structural', 'flow', 'hybrid']
    parameters: list[dict[str, Any]] = Field(default_factory=list)
    capabilities: NodeProviderCapabilityFlags = Field(default_factory=NodeProviderCapabilityFlags)
    route: NodeProviderRouteConfig | None = None
    source: Literal['provider'] = 'provider'
    providerId: str
    pluginId: str


class NodeProviderDefinitionsResponse(BaseModel):
    definitions: list[NodeProviderNodeDefinition] = Field(default_factory=list)
