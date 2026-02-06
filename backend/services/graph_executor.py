from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Union

from agno.agent import Agent
from agno.db.in_memory import InMemoryDb
from agno.team import Team

from .model_factory import get_model
from .tool_registry import get_tool_registry

logger = logging.getLogger(__name__)

_agent_db = InMemoryDb()


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

    include_user_tools = False
    for node in nodes.values():
        if node.get("type") == "chat-start":
            include_user_tools = bool(
                node.get("data", {}).get("includeUserTools", False)
            )
            break

    root_id = _find_root_agent_id(nodes, edges)
    agent = _build_node(root_id, nodes, edges, chat_id, visited=set())

    if include_user_tools and extra_tool_ids:
        registry = get_tool_registry()
        user_tools = registry.resolve_tool_ids(extra_tool_ids, chat_id=chat_id)
        if user_tools:
            existing = list(agent.tools or [])
            existing.extend(user_tools)
            agent.tools = existing

    return GraphBuildResult(agent=agent, include_user_tools=include_user_tools)


def _parse_graph(
    graph_data: dict[str, Any],
) -> tuple[dict[str, dict], list[dict]]:
    nodes_by_id = {n["id"]: n for n in graph_data.get("nodes", [])}
    edges = graph_data.get("edges", [])
    return nodes_by_id, edges


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
    model = _resolve_model(data)

    tool_source_ids, sub_agent_ids = _get_tool_sources(node_id, nodes, edges)
    tools = _resolve_tools(tool_source_ids, nodes, chat_id)

    instructions = []
    if data.get("instructions"):
        instructions.append(data["instructions"])

    name = data.get("name", "Agent")
    description = data.get("description", "")

    if not sub_agent_ids:
        return Agent(
            name=name,
            model=model,
            tools=tools or None,
            description=description,
            instructions=instructions or None,
            markdown=True,
            stream_intermediate_steps=True,
            db=_agent_db,
        )

    members = [
        _build_node(sid, nodes, edges, chat_id, visited) for sid in sub_agent_ids
    ]

    return Team(
        name=name,
        model=model,
        members=members,
        tools=tools or None,
        description=description,
        instructions=instructions or None,
        markdown=True,
        stream_intermediate_steps=True,
        stream_member_events=True,
        db=_agent_db,
    )


def _resolve_model(data: dict[str, Any]) -> Any:
    model_str = data.get("model", "")
    if ":" not in model_str:
        raise ValueError(
            f"Invalid model format '{model_str}' — expected 'provider:model_id'"
        )
    provider, model_id = model_str.split(":", 1)
    return get_model(provider, model_id)


def _resolve_tools(
    source_ids: list[str],
    nodes: dict[str, dict],
    chat_id: str | None,
) -> list[Any]:
    """Resolve MCP server and toolset nodes into tool functions."""
    tools: list[Any] = []
    registry = get_tool_registry()

    for source_id in source_ids:
        source = nodes.get(source_id)
        if not source:
            continue

        node_type = source["type"]
        source_data = source.get("data", {})

        if node_type == "mcp-server":
            server_id = source_data.get("server")
            if server_id:
                tools.extend(
                    registry.resolve_tool_ids([f"mcp:{server_id}"], chat_id=chat_id)
                )

        elif node_type == "toolset":
            toolset_id = source_data.get("toolset")
            if toolset_id:
                tools.extend(
                    registry.resolve_tool_ids(
                        [f"toolset:{toolset_id}"], chat_id=chat_id
                    )
                )

        else:
            logger.warning(f"Unknown tool source node type: {node_type}")

    return tools
