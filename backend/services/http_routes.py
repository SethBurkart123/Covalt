from __future__ import annotations

import json
import types
import uuid
from datetime import UTC, datetime
from typing import Any, AsyncIterator

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from nodes._types import NodeEvent

from .agent_manager import get_agent_manager
from .flow_executor import run_flow
from .tool_registry import get_tool_registry
from .node_route_index import resolve_node_route, rebuild_node_route_index
from .node_route_registry import (
    NodeRouteContext,
    NodeRouteResponse,
    get_node_route_registry,
)

try:
    import jsonschema
except Exception:  # pragma: no cover - optional during tests
    jsonschema = None


def register_http_routes(app: Any) -> None:
    import nodes  # noqa: F401
    rebuild_node_route_index()
    register_webhook_routes(app)
    register_node_routes(app)


def register_webhook_routes(app: Any) -> None:
    @app.post("/webhooks/{hook_id}")
    async def webhook_handler(hook_id: str, request: Request):
        target = resolve_node_route("webhook-trigger", hook_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Webhook not found")

        agent_manager = get_agent_manager()
        agent = agent_manager.get_agent(target.agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        graph_data = agent.get("graph_data", {})
        node = _find_node(graph_data, target.node_id)
        if node is None:
            raise HTTPException(status_code=404, detail="Webhook node not found")

        node_data = node.get("data") if isinstance(node, dict) else {}
        node_data = node_data if isinstance(node_data, dict) else {}

        allow_sse = bool(node_data.get("allowSse", True))
        wants_sse = _wants_sse(request) and allow_sse

        trigger_payload, body_value = await _build_trigger_payload(
            hook_id=hook_id,
            agent_id=target.agent_id,
            node_id=target.node_id,
            request=request,
            node_data=node_data,
        )

        schema = node_data.get("schema")
        if schema:
            _validate_schema(schema, body_value)

        secret = str(node_data.get("secret") or "").strip()
        if secret:
            header_name = str(node_data.get("secretHeader") or "x-webhook-secret")
            provided = request.headers.get(header_name)
            if not provided or provided != secret:
                raise HTTPException(status_code=403, detail="Invalid webhook secret")

        response_payload: dict[str, Any] | None = None
        run_id = str(uuid.uuid4())
        services = types.SimpleNamespace(
            run_handle=None,
            extra_tool_ids=[],
            tool_registry=get_tool_registry(),
            chat_input=None,
            webhook=trigger_payload,
            expression_context={"trigger": trigger_payload},
            execution=types.SimpleNamespace(entry_node_ids=[target.node_id], stop_run=False),
        )
        context = types.SimpleNamespace(
            run_id=run_id,
            chat_id=None,
            state=types.SimpleNamespace(user_message=""),
            services=services,
        )

        if wants_sse:
            async def event_stream() -> AsyncIterator[str]:
                nonlocal response_payload
                yield _sse("RunStarted", {"runId": run_id})
                try:
                    async for item in run_flow(graph_data, context):
                        if isinstance(item, NodeEvent):
                            if item.event_type == "progress":
                                token = (item.data or {}).get("token", "")
                                if token:
                                    yield _sse("RunContent", {"content": token})
                                continue

                            if item.event_type == "agent_event":
                                payload = dict(item.data or {})
                                event_name = str(payload.pop("event", "agent_event"))
                                yield _sse(event_name, payload)
                                continue

                            if item.event_type == "result":
                                response_payload = _extract_webhook_response(item)
                                if response_payload is not None:
                                    services.execution.stop_run = True

                            if item.event_type == "error":
                                payload = _node_event_payload(item)
                                if payload is not None:
                                    yield _sse(payload[0], payload[1])
                                yield _sse(
                                    "RunError",
                                    {"error": (item.data or {}).get("error", "Unknown node error")},
                                )
                                return

                            payload = _node_event_payload(item)
                            if payload is not None:
                                yield _sse(payload[0], payload[1])
                except Exception as exc:
                    yield _sse("RunError", {"error": str(exc)})
                    return

                if response_payload is not None:
                    yield _sse("RunCompleted", {"response": response_payload})
                else:
                    yield _sse("RunCompleted", {})

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        had_error = None
        try:
            async for item in run_flow(graph_data, context):
                if isinstance(item, NodeEvent):
                    if item.event_type == "result":
                        response_payload = _extract_webhook_response(item)
                        if response_payload is not None:
                            services.execution.stop_run = True
                    if item.event_type == "error":
                        had_error = (item.data or {}).get("error", "Unknown node error")
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

        if had_error is not None:
            raise HTTPException(status_code=500, detail=str(had_error))

        if response_payload is None:
            return Response(status_code=204)

        return _build_http_response(response_payload)


def register_node_routes(app: Any) -> None:
    @app.api_route("/nodes/{node_type}/{route_id}", methods=[
        "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"
    ])
    @app.api_route("/nodes/{node_type}/{route_id}/{path:path}", methods=[
        "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"
    ])
    async def node_route_handler(
        node_type: str,
        route_id: str,
        request: Request,
        path: str = "",
    ):
        registry = get_node_route_registry()
        match = registry.match(node_type=node_type, path=path, method=request.method)
        if match is None:
            raise HTTPException(status_code=404, detail="Node route not found")

        target = resolve_node_route(node_type, route_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Node route target not found")

        agent = get_agent_manager().get_agent(target.agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        graph_data = agent.get("graph_data", {})
        node = _find_node(graph_data, target.node_id)
        if node is None:
            raise HTTPException(status_code=404, detail="Node not found")

        body = await _parse_request_body(request)
        node_data = node.get("data") if isinstance(node, dict) else {}
        node_data = node_data if isinstance(node_data, dict) else {}

        route, subpath = match
        ctx = NodeRouteContext(
            node_type=node_type,
            route_id=route_id,
            node_id=target.node_id,
            agent_id=target.agent_id,
            node_data=node_data,
            request=request,
            body=body,
            path=path,
            matched_path=route.path,
            subpath=subpath,
        )

        result = route.handler(ctx)
        if hasattr(result, "__await__"):
            response = await result
        else:
            response = result

        if not isinstance(response, NodeRouteResponse):
            raise HTTPException(status_code=500, detail="Invalid node route response")

        return _build_node_route_response(response)


def _find_node(graph_data: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    for node in graph_data.get("nodes", []):
        if isinstance(node, dict) and node.get("id") == node_id:
            return node
    return None


def _node_event_payload(item: NodeEvent) -> tuple[str, dict[str, Any]] | None:
    if item.event_type == "started":
        return "FlowNodeStarted", {"nodeId": item.node_id, "nodeType": item.node_type}
    if item.event_type == "completed":
        return "FlowNodeCompleted", {"nodeId": item.node_id, "nodeType": item.node_type}
    if item.event_type == "result":
        return "FlowNodeResult", {
            "nodeId": item.node_id,
            "nodeType": item.node_type,
            "outputs": (item.data or {}).get("outputs", {}),
        }
    if item.event_type == "error":
        return "FlowNodeError", {
            "nodeId": item.node_id,
            "nodeType": item.node_type,
            "error": (item.data or {}).get("error", "Unknown node error"),
        }
    return None


def _extract_webhook_response(item: NodeEvent) -> dict[str, Any] | None:
    if item.node_type != "webhook-end" or item.event_type != "result":
        return None
    outputs = (item.data or {}).get("outputs", {})
    response = outputs.get("response")
    if not isinstance(response, dict):
        return None
    value = response.get("value") if isinstance(response, dict) else None
    return value if isinstance(value, dict) else None


def _build_http_response(response_payload: dict[str, Any]) -> Response:
    status = response_payload.get("status", 200)
    try:
        status_code = int(status)
    except (TypeError, ValueError):
        status_code = 200

    headers = response_payload.get("headers")
    headers = headers if isinstance(headers, dict) else {}

    body = response_payload.get("body")
    if status_code == 204:
        return Response(status_code=status_code, headers=headers)
    if isinstance(body, (str, bytes)):
        return Response(content=body, status_code=status_code, headers=headers)

    return JSONResponse(content=body, status_code=status_code, headers=headers)


def _build_node_route_response(response: NodeRouteResponse) -> Response:
    body = response.body
    if response.status == 204:
        return Response(status_code=response.status, headers=response.headers)
    if isinstance(body, (str, bytes)):
        return Response(
            content=body,
            status_code=response.status,
            headers=response.headers,
        )
    return JSONResponse(
        content=body,
        status_code=response.status,
        headers=response.headers,
    )


def _wants_sse(request: Request) -> bool:
    if request.query_params.get("stream") in {"1", "true", "yes"}:
        return True
    accept = request.headers.get("accept", "")
    return "text/event-stream" in accept


def _sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _validate_schema(schema: Any, body: Any) -> None:
    if jsonschema is None:
        raise HTTPException(status_code=500, detail="jsonschema not available")
    try:
        jsonschema.Draft7Validator(schema).validate(body)
    except jsonschema.exceptions.SchemaError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid schema: {exc}")
    except jsonschema.exceptions.ValidationError as exc:
        raise HTTPException(status_code=400, detail=f"Schema validation failed: {exc.message}")


def _get_json_body(raw: bytes) -> Any:
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def _parse_body_text(raw: bytes) -> str:
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except Exception:
        return raw.decode("latin-1", errors="ignore")


def _extract_request_meta(request: Request) -> dict[str, Any]:
    client = request.client
    return {
        "headers": dict(request.headers),
        "query": dict(request.query_params),
        "method": request.method,
        "path": request.url.path,
        "remote": {
            "host": client.host if client else None,
            "port": client.port if client else None,
        },
        "content_type": request.headers.get("content-type"),
    }


async def _build_trigger_payload(
    *,
    hook_id: str,
    agent_id: str,
    node_id: str,
    request: Request,
    node_data: dict[str, Any],
) -> tuple[dict[str, Any], Any]:
    raw = await request.body()
    body_value: Any = None
    parsed_json = False

    content_type = request.headers.get("content-type", "")
    if raw:
        if "application/json" in content_type:
            body_value = _get_json_body(raw)
            parsed_json = True
        else:
            try:
                body_value = _get_json_body(raw)
                parsed_json = True
            except Exception:
                body_value = _parse_body_text(raw)

    if node_data.get("schema") and not parsed_json:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")

    meta = _extract_request_meta(request)
    payload = {
        "body": body_value,
        "hook_id": hook_id,
        "agent_id": agent_id,
        "node_id": node_id,
        "received_at": datetime.now(UTC).isoformat(),
        **meta,
    }
    if isinstance(body_value, dict) and "messages" in body_value:
        payload["messages"] = body_value.get("messages")
    return payload, body_value


async def _parse_request_body(request: Request) -> Any:
    raw = await request.body()
    if not raw:
        return None

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        return _get_json_body(raw)

    try:
        return _get_json_body(raw)
    except Exception:
        return raw
