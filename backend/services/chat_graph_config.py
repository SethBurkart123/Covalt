from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from backend.runtime import runtime_message_to_dict

from nodes import get_executor
from nodes._types import HookType, RuntimeConfigContext
from nodes.node_type_ids import AGENT_NODE_TYPE, CHAT_START_NODE_TYPE

from .. import db
from .agent_manager import get_agent_manager
from .model_selection import parse_model_id
from .plugin_registry import dispatch_hook

logger = logging.getLogger(__name__)

DELEGATION_TOOL_NAMES = {"delegate_task_to_member", "delegate_task_to_members"}
FLOW_EDGE_CHANNEL = "flow"
FlowStreamHandler = Callable[..., Awaitable[None]]
ContentMessageConverter = Callable[..., list[Any]]


def _flow_topology(
    graph_data: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, list[str]]]:
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for node in graph_data.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            nodes_by_id[node_id] = node

    downstream_by_node: dict[str, list[str]] = {}
    upstream_by_node: dict[str, list[str]] = {}

    for edge in graph_data.get("edges", []):
        if not isinstance(edge, dict):
            continue

        data = edge.get("data")
        if not isinstance(data, dict) or data.get("channel") != FLOW_EDGE_CHANNEL:
            continue

        source_id = edge.get("source")
        target_id = edge.get("target")
        if not isinstance(source_id, str) or not isinstance(target_id, str):
            continue

        downstream_by_node.setdefault(source_id, []).append(target_id)
        upstream_by_node.setdefault(target_id, []).append(source_id)

    return nodes_by_id, downstream_by_node, upstream_by_node


def _chat_entry_node_ids(
    nodes_by_id: dict[str, dict[str, Any]],
    upstream_by_node: dict[str, list[str]],
) -> list[str]:
    hook_results = dispatch_hook(
        HookType.ON_ENTRY_RESOLVE,
        {
            "mode": "chat",
            "nodes_by_id": nodes_by_id,
            "upstream_by_node": upstream_by_node,
        },
    )

    candidate_ids: set[str] = set()
    candidate_types: set[str] = set()

    def _collect_candidate(raw: Any) -> None:
        if isinstance(raw, str) and raw.strip():
            value = raw.strip()
            if value in nodes_by_id:
                candidate_ids.add(value)
                return
            candidate_types.add(value)
            return
        if isinstance(raw, dict):
            node_id = raw.get("node_id")
            if isinstance(node_id, str) and node_id.strip() and node_id.strip() in nodes_by_id:
                candidate_ids.add(node_id.strip())
            node_type = raw.get("node_type")
            if isinstance(node_type, str) and node_type.strip():
                candidate_types.add(node_type.strip())

    for result in hook_results:
        if isinstance(result, list):
            for item in result:
                _collect_candidate(item)
            continue
        _collect_candidate(result)

    preferred_ids = sorted(candidate_ids)
    if candidate_types:
        preferred_ids.extend(
            sorted(
                node_id
                for node_id, node in nodes_by_id.items()
                if str(node.get("type") or "") in candidate_types
                and node_id not in candidate_ids
            )
        )

    if preferred_ids:
        return preferred_ids

    chat_start_ids = sorted(
        node_id
        for node_id, node in nodes_by_id.items()
        if str(node.get("type") or "") == CHAT_START_NODE_TYPE
    )
    if chat_start_ids:
        return chat_start_ids

    root_ids = sorted(
        node_id for node_id in nodes_by_id if not upstream_by_node.get(node_id)
    )
    if root_ids:
        return root_ids

    return sorted(nodes_by_id)


def _build_entry_node_ids(graph_data: dict[str, Any]) -> list[str]:
    nodes_by_id, _downstream_by_node, upstream_by_node = _flow_topology(graph_data)
    return _chat_entry_node_ids(nodes_by_id, upstream_by_node)


def _apply_runtime_config(
    graph_data: dict[str, Any],
    services: Any,
    *,
    mode: str,
) -> None:
    nodes = graph_data.get("nodes", [])
    if not isinstance(nodes, list):
        return

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        node_type = node.get("type")
        if not isinstance(node_id, str) or not isinstance(node_type, str):
            continue
        executor = get_executor(node_type)
        if executor is None:
            continue
        configure = getattr(executor, "configure_runtime", None)
        if not callable(configure):
            continue
        try:
            configure(
                node.get("data", {}),
                RuntimeConfigContext(
                    mode=mode,
                    graph_data=graph_data,
                    node_id=node_id,
                    services=services,
                ),
            )
        except Exception:
            logger.exception(
                "[flow_stream] runtime config failed for %s (%s)", node_id, node_type
            )


def _build_trigger_payload(
    user_message: str,
    runtime_messages: list[Any],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    serialized_messages = [
        runtime_message_to_dict(message) if hasattr(message, "role") else dict(message)
        for message in runtime_messages
        if hasattr(message, "role") or isinstance(message, dict)
    ]
    return {
        "message": user_message,
        "last_user_message": user_message,
        "history": serialized_messages,
        "messages": serialized_messages,
        "attachments": attachments,
    }


def _is_delegation_tool(tool_name: str | None) -> bool:
    return tool_name in DELEGATION_TOOL_NAMES


def _get_tool_provider_data(tool: Any) -> dict[str, Any] | None:
    if isinstance(tool, dict):
        provider_data = tool.get("providerData")
        return provider_data if isinstance(provider_data, dict) and provider_data else None

    provider_data = getattr(tool, "provider_data", None)
    if isinstance(provider_data, dict) and provider_data:
        return provider_data

    provider_data = getattr(tool, "providerData", None)
    if isinstance(provider_data, dict) and provider_data:
        return provider_data

    return None


def _normalize_instruction_list(raw_instructions: Any) -> list[str]:
    if isinstance(raw_instructions, str):
        stripped = raw_instructions.strip()
        return [stripped] if stripped else []

    if not isinstance(raw_instructions, list):
        return []

    values: list[str] = []
    for item in raw_instructions:
        if not isinstance(item, str):
            continue
        stripped = item.strip()
        if stripped:
            values.append(stripped)
    return values


def _resolve_model_ref(provider: str, model_id: str) -> str:
    provider_clean = provider.strip()
    model_clean = model_id.strip()

    if not model_clean:
        raise ValueError("Model selection is not configured")

    if not provider_clean and ":" in model_clean:
        provider_clean, model_clean = model_clean.split(":", 1)

    if not provider_clean:
        raise ValueError("Model provider is not configured")

    return f"{provider_clean}:{model_clean}"


def _build_canonical_chat_graph(
    *,
    provider: str,
    model_id: str,
    system_prompt: str,
    instructions: list[str],
    name: str,
    description: str,
    model_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    model_ref = _resolve_model_ref(provider, model_id)

    prompt_sections = [
        section for section in [system_prompt.strip(), *instructions] if section
    ]
    agent_data: dict[str, Any] = {
        "name": name,
        "description": description,
        "model": model_ref,
    }
    if prompt_sections:
        agent_data["instructions"] = "\n\n".join(prompt_sections)
    if model_options is not None:
        agent_data["model_options"] = dict(model_options)

    return {
        "nodes": [
            {
                "id": "entry-1",
                "type": CHAT_START_NODE_TYPE,
                "position": {"x": 120.0, "y": 160.0},
                "data": {"includeUserTools": True},
            },
            {
                "id": "agent-1",
                "type": AGENT_NODE_TYPE,
                "position": {"x": 420.0, "y": 160.0},
                "data": agent_data,
            },
        ],
        "edges": [
            {
                "id": "e-entry-1-agent-1",
                "source": "entry-1",
                "sourceHandle": "output",
                "target": "agent-1",
                "targetHandle": "input",
                "data": {
                    "sourceType": "data",
                    "targetType": "data",
                    "channel": "flow",
                },
            }
        ],
    }


def get_graph_data_for_chat(
    chat_id: str,
    model_id: str | None,
    model_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id) or {}
        system_prompt = db.get_system_prompt_setting(sess) or ""

    agent_id: str | None = None

    if model_id:
        if model_id.startswith("agent:"):
            agent_id = model_id[len("agent:") :]
        else:
            provider, parsed_model = parse_model_id(model_id)
            if not provider:
                provider = str(config.get("provider") or "")
            if not parsed_model:
                parsed_model = str(config.get("model_id") or "")
            instructions = _normalize_instruction_list(config.get("instructions"))
            name = str(config.get("name") or "Assistant")
            description = str(
                config.get("description") or "You are a helpful AI assistant."
            )
            return _build_canonical_chat_graph(
                provider=provider,
                model_id=parsed_model,
                system_prompt=system_prompt,
                instructions=instructions,
                name=name,
                description=description,
                model_options=model_options,
            )

    if not agent_id and isinstance(config, dict):
        configured_agent = config.get("agent_id")
        if isinstance(configured_agent, str) and configured_agent:
            agent_id = configured_agent

    if agent_id:
        agent_manager = get_agent_manager()
        agent_data = agent_manager.get_agent(agent_id)
        if not agent_data:
            raise ValueError(f"Agent '{agent_id}' not found")
        return agent_data["graph_data"]

    provider = str(config.get("provider") or "")
    configured_model = str(config.get("model_id") or "")
    instructions = _normalize_instruction_list(config.get("instructions"))
    name = str(config.get("name") or "Assistant")
    description = str(config.get("description") or "You are a helpful AI assistant.")

    return _build_canonical_chat_graph(
        provider=provider,
        model_id=configured_model,
        system_prompt=system_prompt,
        instructions=instructions,
        name=name,
        description=description,
        model_options=model_options,
    )


def _count_agent_nodes(graph_data: dict[str, Any]) -> int:
    nodes = graph_data.get("nodes", [])
    if not isinstance(nodes, list):
        return 0
    count = 0
    for node in nodes:
        if isinstance(node, dict) and node.get("type") == "agent":
            count += 1
    return count
