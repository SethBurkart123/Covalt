from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Union

from agno.agent import Agent
from agno.team import Team

from nodes import get_executor
from nodes._types import BuildContext, ToolsResult

from .tool_registry import get_tool_registry

logger = logging.getLogger(__name__)


@dataclass
class GraphBuildResult:
    agent: Agent | Team
    include_user_tools: bool


def build_agent_from_graph(
    graph_data: dict[str, Any],
    chat_id: str | None = None,
    extra_tool_ids: list[str] | None = None,
) -> GraphBuildResult:
    """Build a fully configured Agno Agent or Team from a node graph.

    Returns a GraphBuildResult with the agent/team and metadata from the Chat Start node.
    When extra_tool_ids is provided and the graph's includeUserTools is True,
    these tools are merged into the root agent.
    """
    nodes, edges = _parse_graph(graph_data)

    include_user_tools = _extract_include_user_tools(nodes)

    root_id = _find_root_agent_id(nodes, edges)
    agent = _build_node(root_id, nodes, edges, chat_id, visited=set())

    if include_user_tools and extra_tool_ids:
        _merge_extra_tools(agent, extra_tool_ids, chat_id)

    return GraphBuildResult(agent=agent, include_user_tools=include_user_tools)


def _parse_graph(
    graph_data: dict[str, Any],
) -> tuple[dict[str, dict], list[dict]]:
    nodes_by_id = {n["id"]: n for n in graph_data.get("nodes", [])}
    edges = graph_data.get("edges", [])
    return nodes_by_id, edges


def _extract_include_user_tools(nodes: dict[str, dict]) -> bool:
    for node in nodes.values():
        if node.get("type") == "chat-start":
            return bool(node.get("data", {}).get("includeUserTools", False))
    return False


def _find_root_agent_id(
    nodes: dict[str, dict],
    edges: list[dict],
) -> str:
    chat_start_ids = {nid for nid, n in nodes.items() if n["type"] == "chat-start"}
    if not chat_start_ids:
        raise ValueError("Graph has no Chat Start node")

    for edge in edges:
        if (
            edge["source"] in chat_start_ids
            and edge.get("sourceHandle") == "agent"
            and edge.get("targetHandle") == "agent"
        ):
            target = edge["target"]
            if nodes.get(target, {}).get("type") == "agent":
                return target

    raise ValueError("Chat Start is not connected to an Agent node")


def _get_tool_sources(
    agent_node_id: str,
    nodes: dict[str, dict],
    edges: list[dict],
) -> tuple[list[str], list[str]]:
    """Split tool sources into (regular tool node IDs, sub-agent node IDs)."""
    tool_ids: list[str] = []
    agent_ids: list[str] = []

    for edge in edges:
        if edge["target"] != agent_node_id or edge.get("targetHandle") != "tools":
            continue
        source = nodes.get(edge["source"])
        if not source:
            continue
        if source["type"] == "agent":
            agent_ids.append(edge["source"])
        else:
            tool_ids.append(edge["source"])

    return tool_ids, agent_ids


def _build_node(
    node_id: str,
    nodes: dict[str, dict],
    edges: list[dict],
    chat_id: str | None,
    visited: set[str],
) -> Union[Agent, Team]:
    """Build an Agent (no sub-agents) or Team (has sub-agents) from a graph node."""
    if node_id in visited:
        raise ValueError(f"Circular reference detected at node '{node_id}'")
    visited.add(node_id)

    node = nodes[node_id]
    data = node.get("data", {})

    tool_source_ids, sub_agent_ids = _get_tool_sources(node_id, nodes, edges)
    resolved_tools = _resolve_tools(tool_source_ids, nodes, chat_id)

    sub_agents = [
        _build_node(sid, nodes, edges, chat_id, visited) for sid in sub_agent_ids
    ]

    executor = get_executor("agent")
    if executor is None:
        raise ValueError("No executor registered for node type 'agent'")

    context = BuildContext(
        node_id=node_id,
        chat_id=chat_id,
        tool_sources=[{"tools": resolved_tools}] if resolved_tools else [],
        sub_agents=sub_agents,
        tool_registry=get_tool_registry(),
    )
    result = executor.build(data, context)
    return result.agent


def _resolve_tools(
    source_ids: list[str],
    nodes: dict[str, dict],
    chat_id: str | None,
) -> list[Any]:
    """Resolve tool source nodes into tool functions via their executors."""
    tools: list[Any] = []
    registry = get_tool_registry()

    for source_id in source_ids:
        source = nodes.get(source_id)
        if not source:
            continue

        node_type = source["type"]
        source_data = source.get("data", {})

        executor = get_executor(node_type)
        if executor is None:
            logger.warning(f"No executor for node type: {node_type}")
            continue

        context = BuildContext(
            node_id=source_id,
            chat_id=chat_id,
            tool_sources=[],
            sub_agents=[],
            tool_registry=registry,
        )
        result = executor.build(source_data, context)
        if isinstance(result, ToolsResult):
            tools.extend(result.tools)

    return tools


def _merge_extra_tools(
    agent: Agent | Team,
    extra_tool_ids: list[str],
    chat_id: str | None,
) -> None:
    registry = get_tool_registry()
    user_tools = registry.resolve_tool_ids(extra_tool_ids, chat_id=chat_id)
    if user_tools:
        existing = list(agent.tools or [])
        existing.extend(user_tools)
        agent.tools = existing
