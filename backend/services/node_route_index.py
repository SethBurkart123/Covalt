from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from nodes._types import HookType

from .. import db
from ..db.models import Agent
from .graph_normalizer import normalize_graph_data
from .plugin_registry import dispatch_hook

logger = logging.getLogger(__name__)


@dataclass
class NodeRouteTarget:
    agent_id: str
    node_id: str


_ROUTE_INDEX: dict[tuple[str, str], NodeRouteTarget] = {}
_ROUTES_BY_AGENT: dict[str, set[tuple[str, str]]] = {}
_ROUTE_ID_INDEX: dict[str, set[tuple[str, str]]] = {}


def rebuild_node_route_index() -> None:
    _ROUTE_INDEX.clear()
    _ROUTES_BY_AGENT.clear()
    _ROUTE_ID_INDEX.clear()

    with db.db_session() as sess:
        agents = sess.query(Agent).all()
        for agent in agents:
            try:
                graph = json.loads(agent.graph_data)
            except Exception:
                continue
            normalized = normalize_graph_data(graph.get("nodes", []), graph.get("edges", []))
            _index_agent_graph(agent.id, normalized)


def update_agent_routes(agent_id: str, graph_data: dict[str, Any]) -> None:
    _remove_agent_routes(agent_id)
    _index_agent_graph(agent_id, graph_data)


def remove_agent_routes(agent_id: str) -> None:
    _remove_agent_routes(agent_id)


def resolve_node_route(node_type: str, route_id: str) -> NodeRouteTarget | None:
    return _ROUTE_INDEX.get((node_type, route_id))


def resolve_node_route_by_id(route_id: str) -> NodeRouteTarget | None:
    keys = sorted(_ROUTE_ID_INDEX.get(route_id, set()))
    if not keys:
        return None
    return _ROUTE_INDEX.get(keys[0])


def _remove_agent_routes(agent_id: str) -> None:
    keys = _ROUTES_BY_AGENT.pop(agent_id, set())
    for key in keys:
        _ROUTE_INDEX.pop(key, None)
        route_id = key[1]
        route_keys = _ROUTE_ID_INDEX.get(route_id)
        if route_keys is None:
            continue
        route_keys.discard(key)
        if not route_keys:
            _ROUTE_ID_INDEX.pop(route_id, None)


def _index_agent_graph(agent_id: str, graph_data: dict[str, Any]) -> None:
    nodes = graph_data.get("nodes", []) if isinstance(graph_data, dict) else []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("type")
        node_id = node.get("id")
        if not isinstance(node_type, str) or not isinstance(node_id, str):
            continue

        route_id = _extract_route_id(node_type, node)
        if not route_id:
            continue

        key = (node_type, route_id)
        existing = _ROUTE_INDEX.get(key)
        if existing and (existing.agent_id != agent_id or existing.node_id != node_id):
            logger.warning(
                "[node_route_index] duplicate route (%s, %s) from %s/%s; replacing previous %s/%s (last write wins)",
                node_type,
                route_id,
                agent_id,
                node_id,
                existing.agent_id,
                existing.node_id,
            )

        _ROUTE_INDEX[key] = NodeRouteTarget(agent_id=agent_id, node_id=node_id)
        _ROUTES_BY_AGENT.setdefault(agent_id, set()).add(key)
        _ROUTE_ID_INDEX.setdefault(route_id, set()).add(key)


def _extract_route_id(node_type: str, node: dict[str, Any]) -> str:
    data = node.get("data")
    if not isinstance(data, dict):
        return ""

    hook_results = dispatch_hook(
        HookType.ON_ROUTE_EXTRACT,
        {"node_type": node_type, "node": node, "data": data},
    )
    for result in hook_results:
        if isinstance(result, str) and result.strip():
            return result.strip()

    route_id = data.get("routeId")
    if isinstance(route_id, str) and route_id.strip():
        return route_id.strip()

    hook_id = data.get("hookId")
    return str(hook_id).strip() if isinstance(hook_id, str) else ""
