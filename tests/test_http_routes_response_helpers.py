from __future__ import annotations

from backend.services.http_routes import _build_http_response, _build_node_route_response
from backend.services.node_route_registry import NodeRouteResponse


def test_build_http_response_defaults_invalid_status_to_200() -> None:
    response = _build_http_response({"status": "not-a-number", "body": {"ok": True}})

    assert response.status_code == 200
    assert response.body == b'{"ok":true}'


def test_build_http_response_uses_raw_body_for_text() -> None:
    response = _build_http_response({"status": 201, "headers": {"x-test": "1"}, "body": "hello"})

    assert response.status_code == 201
    assert response.headers.get("x-test") == "1"
    assert response.body == b"hello"


def test_build_http_response_returns_empty_body_for_204() -> None:
    response = _build_http_response({"status": 204, "body": {"ignored": True}})

    assert response.status_code == 204
    assert response.body == b""


def test_build_node_route_response_shapes_json_body() -> None:
    response = _build_node_route_response(
        NodeRouteResponse(status=202, headers={"x-node": "ok"}, body={"result": "done"})
    )

    assert response.status_code == 202
    assert response.headers.get("x-node") == "ok"
    assert response.body == b'{"result":"done"}'


def test_build_node_route_response_returns_empty_body_for_204() -> None:
    response = _build_node_route_response(NodeRouteResponse(status=204, headers={"x-node": "ok"}, body="ignored"))

    assert response.status_code == 204
    assert response.headers.get("x-node") == "ok"
    assert response.body == b""
