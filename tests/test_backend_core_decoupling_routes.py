from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.services.http_routes as http_routes
import backend.services.node_route_index as node_route_index
from nodes._types import HookType, NodeEvent


@pytest.fixture(autouse=True)
def _reset_route_index_state() -> None:
    node_route_index._ROUTE_INDEX.clear()
    node_route_index._ROUTES_BY_AGENT.clear()
    node_route_index._ROUTE_ID_INDEX.clear()


def _graph(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {"nodes": nodes, "edges": []}


def test_node_route_index_uses_on_route_extract_hook(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []

    def fake_dispatch(hook_type: HookType, context: dict[str, Any]) -> list[Any]:
        captured.append({"hook_type": hook_type, "context": context})
        return ["derived-route"]

    monkeypatch.setattr(node_route_index, "dispatch_hook", fake_dispatch, raising=False)

    node_route_index.update_agent_routes(
        "agent-1",
        _graph(nodes=[{"id": "n1", "type": "custom-trigger", "data": {"k": "v"}}]),
    )

    target = node_route_index.resolve_node_route("custom-trigger", "derived-route")

    assert target is not None
    assert target.agent_id == "agent-1"
    assert target.node_id == "n1"
    assert captured and captured[0]["hook_type"] is HookType.ON_ROUTE_EXTRACT


def test_node_route_index_falls_back_to_generic_hook_id_for_route_capable_nodes(
    monkeypatch,
) -> None:
    monkeypatch.setattr(node_route_index, "dispatch_hook", lambda *_args, **_kwargs: [])

    node_route_index.update_agent_routes(
        "agent-2",
        _graph(nodes=[{"id": "n2", "type": "provider:trigger", "data": {"hookId": "hook-22"}}]),
    )

    assert node_route_index.resolve_node_route("provider:trigger", "hook-22") is not None


def test_node_route_index_route_id_collision_prefers_last_write_with_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(node_route_index, "dispatch_hook", lambda *_args, **_kwargs: [])

    first_graph = _graph(
        nodes=[{"id": "node-1", "type": "provider:trigger", "data": {"routeId": "dup"}}]
    )
    second_graph = _graph(
        nodes=[{"id": "node-2", "type": "provider:trigger", "data": {"routeId": "dup"}}]
    )

    node_route_index.update_agent_routes("agent-1", first_graph)
    with caplog.at_level("WARNING"):
        node_route_index.update_agent_routes("agent-2", second_graph)

    target = node_route_index.resolve_node_route("provider:trigger", "dup")

    assert target is not None
    assert target.agent_id == "agent-2"
    assert target.node_id == "node-2"
    assert "duplicate route" in caplog.text.lower()


def test_node_route_index_route_id_collision_across_node_types_uses_global_last_write(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(node_route_index, "dispatch_hook", lambda *_args, **_kwargs: [])

    first_graph = _graph(
        nodes=[{"id": "node-a", "type": "provider:trigger-a", "data": {"routeId": "dup"}}]
    )
    second_graph = _graph(
        nodes=[{"id": "node-b", "type": "provider:trigger-b", "data": {"routeId": "dup"}}]
    )

    node_route_index.update_agent_routes("agent-1", first_graph)
    with caplog.at_level("WARNING"):
        node_route_index.update_agent_routes("agent-2", second_graph)

    target = node_route_index.resolve_node_route_by_id("dup")

    assert target is not None
    assert target.agent_id == "agent-2"
    assert target.node_id == "node-b"
    assert node_route_index.resolve_node_route("provider:trigger-a", "dup") is None
    assert node_route_index.resolve_node_route("provider:trigger-b", "dup") is not None
    assert "last write wins" in caplog.text.lower()


def test_node_route_index_transfers_route_ownership_on_overwrite() -> None:
    graph_one = _graph(
        nodes=[{"id": "node-1", "type": "provider:trigger", "data": {"routeId": "shared"}}]
    )
    graph_two = _graph(
        nodes=[{"id": "node-2", "type": "provider:trigger", "data": {"routeId": "shared"}}]
    )

    node_route_index.update_agent_routes("agent-1", graph_one)
    node_route_index.update_agent_routes("agent-2", graph_two)

    assert ("provider:trigger", "shared") not in node_route_index._ROUTES_BY_AGENT.get("agent-1", set())
    assert ("provider:trigger", "shared") in node_route_index._ROUTES_BY_AGENT.get("agent-2", set())

    node_route_index.remove_agent_routes("agent-1")

    typed_target = node_route_index.resolve_node_route("provider:trigger", "shared")
    by_id_target = node_route_index.resolve_node_route_by_id("shared")

    assert typed_target is not None
    assert typed_target.agent_id == "agent-2"
    assert typed_target.node_id == "node-2"
    assert by_id_target is not None
    assert by_id_target.agent_id == "agent-2"
    assert by_id_target.node_id == "node-2"


def test_webhook_handler_uses_generic_route_lookup(monkeypatch) -> None:
    app = FastAPI()
    http_routes.register_webhook_routes(app)

    def fail_legacy_lookup(*_args: Any, **_kwargs: Any):
        raise AssertionError("legacy typed route lookup should not be used")

    monkeypatch.setattr(http_routes, "resolve_node_route", fail_legacy_lookup)
    monkeypatch.setattr(http_routes, "resolve_node_route_by_id", lambda _route_id: None, raising=False)

    client = TestClient(app)
    response = client.post("/webhooks/missing", json={"ok": True})

    assert response.status_code == 404
    assert response.json()["detail"] == "Webhook not found"


def test_node_route_index_prefers_webhook_hook_id_from_builtin_hook() -> None:
    node_route_index.update_agent_routes(
        "agent-webhook-priority",
        _graph(
            nodes=[
                {
                    "id": "trigger-1",
                    "type": "webhook-trigger",
                    "data": {"hookId": "hook-priority", "routeId": "route-fallback"},
                }
            ]
        ),
    )

    preferred_target = node_route_index.resolve_node_route_by_id("hook-priority")
    fallback_target = node_route_index.resolve_node_route_by_id("route-fallback")

    assert preferred_target is not None
    assert preferred_target.agent_id == "agent-webhook-priority"
    assert preferred_target.node_id == "trigger-1"
    assert fallback_target is None


class _FakeAgentManager:
    def __init__(self, graph_data: dict[str, Any]) -> None:
        self._graph_data = graph_data

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        if agent_id != "agent-webhook-flow":
            return None
        return {
            "id": agent_id,
            "graph_data": self._graph_data,
        }


def test_webhook_handler_executes_webhook_flow_end_to_end(monkeypatch) -> None:
    app = FastAPI()
    http_routes.register_webhook_routes(app)

    graph_data = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "webhook-trigger",
                "position": {"x": 0, "y": 0},
                "data": {"hookId": "hook-e2e"},
            },
            {
                "id": "end-1",
                "type": "webhook-end",
                "position": {"x": 240, "y": 0},
                "data": {
                    "status": 201,
                    "headers": {"x-webhook-flow": "ok"},
                },
            },
        ],
        "edges": [
            {
                "id": "e-trigger-end",
                "source": "trigger-1",
                "sourceHandle": "output",
                "target": "end-1",
                "targetHandle": "body",
                "data": {
                    "channel": "flow",
                    "sourceType": "data",
                    "targetType": "data",
                },
            }
        ],
    }

    node_route_index.update_agent_routes("agent-webhook-flow", graph_data)
    monkeypatch.setattr(
        http_routes,
        "get_agent_manager",
        lambda: _FakeAgentManager(graph_data),
        raising=False,
    )

    client = TestClient(app)
    response = client.post("/webhooks/hook-e2e", json={"test": True})

    assert response.status_code == 201
    assert response.headers.get("x-webhook-flow") == "ok"

    payload = response.json()
    assert payload["hook_id"] == "hook-e2e"
    assert payload["agent_id"] == "agent-webhook-flow"
    assert payload["node_id"] == "trigger-1"
    assert payload["method"] == "POST"
    assert payload["path"] == "/webhooks/hook-e2e"
    assert payload["body"] == {"test": True}


def test_extract_node_response_uses_on_response_extract_hook(monkeypatch) -> None:
    seen: list[dict[str, Any]] = []

    def fake_dispatch(hook_type: HookType, context: dict[str, Any]) -> list[Any]:
        seen.append({"hook_type": hook_type, "context": context})
        return [{"status": 201, "headers": {"x-hook": "1"}, "body": {"ok": True}}]

    monkeypatch.setattr(http_routes, "dispatch_hook", fake_dispatch, raising=False)

    event = NodeEvent(
        node_id="n1",
        node_type="custom-response",
        event_type="result",
        run_id="run-1",
        data={"outputs": {}},
    )

    response_payload = http_routes._extract_node_response(event)

    assert response_payload == {"status": 201, "headers": {"x-hook": "1"}, "body": {"ok": True}}
    assert seen and seen[0]["hook_type"] is HookType.ON_RESPONSE_EXTRACT


def test_extract_node_response_falls_back_to_response_output_shape(monkeypatch) -> None:
    monkeypatch.setattr(http_routes, "dispatch_hook", lambda *_args, **_kwargs: [], raising=False)

    event = NodeEvent(
        node_id="n2",
        node_type="provider:responder",
        event_type="result",
        run_id="run-2",
        data={
            "outputs": {
                "response": {
                    "type": "data",
                    "value": {"status": 202, "headers": {"x": "y"}, "body": {"ok": True}},
                }
            }
        },
    )

    assert http_routes._extract_node_response(event) == {
        "status": 202,
        "headers": {"x": "y"},
        "body": {"ok": True},
    }
