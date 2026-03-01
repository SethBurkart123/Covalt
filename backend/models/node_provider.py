
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class NodeProviderPluginInfo(BaseModel):
    id: str
    name: str
    version: str
    enabled: bool = True
    installedAt: Optional[str] = None
    sourceType: Optional[str] = None
    sourceRef: Optional[str] = None
    repoUrl: Optional[str] = None
    trackingRef: Optional[str] = None
    pluginPath: Optional[str] = None
    error: Optional[str] = None


class NodeProviderPluginsResponse(BaseModel):
    plugins: List[NodeProviderPluginInfo] = Field(default_factory=list)


class InstallNodeProviderPluginFromRepoInput(BaseModel):
    repoUrl: str
    ref: Optional[str] = 'main'
    pluginPath: Optional[str] = None


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
    methods: List[str] = Field(default_factory=lambda: ['POST'])
    mode: Literal['trigger', 'proxy'] = 'trigger'


class NodeProviderRouteConfig(BaseModel):
    idField: Literal['routeId', 'hookId'] = 'routeId'
    entries: List[NodeProviderRouteEntry] = Field(default_factory=list)


class NodeProviderNodeDefinition(BaseModel):
    type: str
    name: str
    description: Optional[str] = None
    category: Literal['trigger', 'llm', 'tools', 'flow', 'data', 'integration', 'rag', 'utility']
    icon: str
    executionMode: Literal['structural', 'flow', 'hybrid']
    parameters: List[Dict[str, Any]] = Field(default_factory=list)
    capabilities: NodeProviderCapabilityFlags = Field(default_factory=NodeProviderCapabilityFlags)
    route: Optional[NodeProviderRouteConfig] = None
    source: Literal['provider'] = 'provider'
    providerId: str
    pluginId: str


class NodeProviderDefinitionsResponse(BaseModel):
    definitions: List[NodeProviderNodeDefinition] = Field(default_factory=list)
