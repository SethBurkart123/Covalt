from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from fastapi import Request


@dataclass
class NodeRouteResponse:
    status: int = 200
    headers: dict[str, str] = field(default_factory=dict)
    body: Any = None


@dataclass
class NodeRouteContext:
    node_type: str
    route_id: str
    node_id: str
    agent_id: str
    node_data: dict[str, Any]
    request: Request
    body: Any
    path: str
    matched_path: str
    subpath: str


NodeRouteHandler = Callable[[NodeRouteContext], Awaitable[NodeRouteResponse] | NodeRouteResponse]


@dataclass
class NodeRoute:
    node_type: str
    path: str
    methods: tuple[str, ...]
    handler: NodeRouteHandler


class NodeRouteRegistry:
    def __init__(self) -> None:
        self._routes: list[NodeRoute] = []

    def register(
        self,
        *,
        node_type: str,
        path: str,
        methods: list[str] | tuple[str, ...],
        handler: NodeRouteHandler,
    ) -> None:
        normalized_path = _normalize_path(path)
        normalized_methods = tuple(m.upper() for m in methods)
        self._routes.append(
            NodeRoute(
                node_type=node_type,
                path=normalized_path,
                methods=normalized_methods,
                handler=handler,
            )
        )

    def match(
        self, *, node_type: str, path: str, method: str
    ) -> tuple[NodeRoute, str] | None:
        normalized_path = _normalize_path(path)
        method = method.upper()

        candidates = [
            route
            for route in self._routes
            if route.node_type == node_type
            and (not route.methods or method in route.methods)
        ]

        for route in candidates:
            matched, subpath = _match_path(route.path, normalized_path)
            if matched:
                return route, subpath

        return None


_registry = NodeRouteRegistry()


def get_node_route_registry() -> NodeRouteRegistry:
    return _registry


def _normalize_path(path: str) -> str:
    return path.strip("/")


def _match_path(registered: str, incoming: str) -> tuple[bool, str]:
    if registered.endswith("/*"):
        prefix = registered[:-2].rstrip("/")
        if not prefix:
            return True, incoming
        if incoming == prefix:
            return True, ""
        if incoming.startswith(prefix + "/"):
            return True, incoming[len(prefix) + 1 :]
        return False, ""

    return (registered == incoming), ""
