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
