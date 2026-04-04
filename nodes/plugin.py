"""Builtin node plugin registration for executors and lifecycle hooks."""

from __future__ import annotations

from typing import Any

from backend.services.plugin_registry import PluginRegistry
from nodes._types import HookType, NodeEvent
from nodes.ai.llm_completion.executor import executor as llm_completion_executor
from nodes.ai.prompt_template.executor import executor as prompt_template_executor
from nodes.core.agent.executor import executor as agent_executor
from nodes.core.chat_start.executor import executor as chat_start_executor
from nodes.core.webhook_end.executor import executor as webhook_end_executor
from nodes.core.webhook_trigger.executor import executor as webhook_trigger_executor
from nodes.data.code.executor import executor as code_executor
from nodes.flow.conditional.executor import executor as conditional_executor
from nodes.flow.merge.executor import executor as merge_executor
from nodes.flow.reroute.executor import executor as reroute_executor
from nodes.tools.mcp_server.executor import executor as mcp_server_executor
from nodes.tools.toolset.executor import executor as toolset_executor
from nodes.utility.model_selector.executor import executor as model_selector_executor

BUILTIN_EXECUTOR_MODULES: dict[str, str] = {
    "chat-start": "nodes.core.chat_start.executor",
    "webhook-trigger": "nodes.core.webhook_trigger.executor",
    "webhook-end": "nodes.core.webhook_end.executor",
    "agent": "nodes.core.agent.executor",
    "llm-completion": "nodes.ai.llm_completion.executor",
    "prompt-template": "nodes.ai.prompt_template.executor",
    "conditional": "nodes.flow.conditional.executor",
    "merge": "nodes.flow.merge.executor",
    "reroute": "nodes.flow.reroute.executor",
    "mcp-server": "nodes.tools.mcp_server.executor",
    "toolset": "nodes.tools.toolset.executor",
    "code": "nodes.data.code.executor",
    "model-selector": "nodes.utility.model_selector.executor",
}

BUILTIN_EXECUTORS = {
    chat_start_executor.node_type: chat_start_executor,
    webhook_trigger_executor.node_type: webhook_trigger_executor,
    webhook_end_executor.node_type: webhook_end_executor,
    agent_executor.node_type: agent_executor,
    llm_completion_executor.node_type: llm_completion_executor,
    prompt_template_executor.node_type: prompt_template_executor,
    conditional_executor.node_type: conditional_executor,
    merge_executor.node_type: merge_executor,
    reroute_executor.node_type: reroute_executor,
    mcp_server_executor.node_type: mcp_server_executor,
    toolset_executor.node_type: toolset_executor,
    code_executor.node_type: code_executor,
    model_selector_executor.node_type: model_selector_executor,
}


def _extract_route_id(context: dict[str, Any]) -> str | None:
    node_type = context.get("node_type")
    if node_type != "webhook-trigger":
        return None

    data = context.get("data")
    if not isinstance(data, dict):
        return None

    hook_id = data.get("hookId")
    if isinstance(hook_id, str) and hook_id.strip():
        return hook_id.strip()

    route_id = data.get("routeId")
    if isinstance(route_id, str) and route_id.strip():
        return route_id.strip()

    return None


def _resolve_chat_entry(context: dict[str, Any]) -> str | None:
    mode = context.get("mode")
    if mode != "chat":
        return None
    return "chat-start"


def _extract_response_payload(context: dict[str, Any]) -> dict[str, Any] | None:
    node_type = context.get("node_type")
    if node_type != "webhook-end":
        return None

    event = context.get("event")
    if not isinstance(event, NodeEvent) or event.event_type != "result":
        return None

    outputs = (event.data or {}).get("outputs", {})
    if not isinstance(outputs, dict):
        return None

    response = outputs.get("response")
    if not isinstance(response, dict):
        return None

    value = response.get("value")
    if isinstance(value, dict):
        return value

    return None


def register_builtin_plugin(registry: PluginRegistry) -> None:
    registry.register_plugin(
        "builtin",
        executors=dict(BUILTIN_EXECUTORS),
        hooks={
            HookType.ON_ENTRY_RESOLVE: [_resolve_chat_entry],
            HookType.ON_ROUTE_EXTRACT: [_extract_route_id],
            HookType.ON_RESPONSE_EXTRACT: [_extract_response_payload],
        },
        metadata={"is_builtin": True, "name": "Built-in Nodes"},
    )
