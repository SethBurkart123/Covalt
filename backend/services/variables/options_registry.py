"""Registry of named loaders that produce variable option lists."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any

from backend.services.flows.graph_runtime import GraphRuntime

OptionsLoader = Callable[[dict[str, Any]], Awaitable[list[dict[str, Any]]] | list[dict[str, Any]]]

_loaders: dict[str, OptionsLoader] = {}


def register_options_loader(loader_id: str, loader: OptionsLoader) -> None:
    if not loader_id or not isinstance(loader_id, str):
        raise ValueError("Options loader id must be a non-empty string")
    existing = _loaders.get(loader_id)
    if existing is not None and existing is not loader:
        raise ValueError(f"Options loader '{loader_id}' is already registered")
    _loaders[loader_id] = loader


async def resolve_options_via_callback(
    loader_id: str, params: dict[str, Any] | None
) -> list[dict[str, Any]]:
    loader = _loaders.get(loader_id)
    if loader is None:
        raise KeyError(f"Unknown options loader: {loader_id}")

    result = loader(params or {})
    if inspect.isawaitable(result):
        result = await result
    if not isinstance(result, list):
        raise TypeError(f"Options loader '{loader_id}' must return a list")
    return [_normalize_option(item) for item in result if isinstance(item, dict)]


async def resolve_options_via_link(
    graph_data: dict[str, Any] | None,
    chat_start_node_id: str,
    handle: str,
) -> list[dict[str, Any]]:
    """Resolve via `materialize_output` so any provider node can supply options."""
    if not isinstance(graph_data, dict):
        return []

    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return []

    upstream = _find_upstream(edges, chat_start_node_id, handle)
    if upstream is None:
        return []

    source_id, source_handle = upstream
    raw = await _materialize(graph_data, source_id, source_handle)
    return _coerce_to_options(raw)


def _find_upstream(
    edges: list[Any],
    target_node_id: str,
    target_handle: str,
) -> tuple[str, str] | None:
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        if edge.get("target") != target_node_id:
            continue
        if edge.get("targetHandle") != target_handle:
            continue
        data = edge.get("data") or {}
        if data.get("channel") != "link":
            continue
        source = edge.get("source")
        source_handle = edge.get("sourceHandle") or "output"
        if isinstance(source, str) and source:
            return source, source_handle
    return None


async def _materialize(
    graph_data: dict[str, Any],
    source_id: str,
    source_handle: str,
) -> Any:
    runtime = GraphRuntime(
        graph_data,
        run_id="variables-options",
        chat_id=None,
        state=None,
        services=None,
    )
    return await runtime.materialize_output(source_id, source_handle)


def _coerce_to_options(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [_coerce_option(item) for item in value if item is not None]
    if isinstance(value, dict):
        if isinstance(value.get("options"), list):
            return _coerce_to_options(value["options"])
    return []


def _coerce_option(item: Any) -> dict[str, Any]:
    if isinstance(item, dict) and "value" in item:
        return _normalize_option(item)
    if isinstance(item, dict) and "label" in item:
        return _normalize_option({"value": item["label"], **item})
    return _normalize_option({"value": item, "label": str(item)})


def _normalize_option(option: dict[str, Any]) -> dict[str, Any]:
    return {
        "value": option.get("value"),
        "label": str(option.get("label", option.get("value", ""))),
        **({"group": option["group"]} if option.get("group") else {}),
        **({"icon": option["icon"]} if option.get("icon") else {}),
    }
