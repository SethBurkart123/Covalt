from __future__ import annotations

from backend.models import (
    NodeProviderDefinitionsResponse,
)
from backend.models import (
    chat as chat_models,
)
from backend.models import (
    node_provider as node_provider_models,
)

NODE_PROVIDER_MODEL_NAMES = [
    "NodeProviderPluginInfo",
    "NodeProviderPluginsResponse",
    "InstallNodeProviderPluginFromRepoInput",
    "InstallNodeProviderPluginFromDirectoryInput",
    "EnableNodeProviderPluginInput",
    "NodeProviderPluginIdInput",
    "NodeProviderCapabilityFlags",
    "NodeProviderRouteEntry",
    "NodeProviderRouteConfig",
    "NodeProviderNodeDefinition",
    "NodeProviderDefinitionsResponse",
]


def test_chat_models_reexport_node_provider_models() -> None:
    for name in NODE_PROVIDER_MODEL_NAMES:
        assert getattr(chat_models, name) is getattr(node_provider_models, name)


def test_backend_models_reexport_uses_canonical_node_provider_models() -> None:
    assert NodeProviderDefinitionsResponse is node_provider_models.NodeProviderDefinitionsResponse
