from __future__ import annotations

import json
import types
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from nodes._types import HookType, NodeEvent

from ..node_providers.node_provider_registry import get_provider_node_registration
from ..node_providers.node_provider_runtime import handle_provider_route
from ..node_providers.node_route_index import rebuild_node_route_index, resolve_node_route, resolve_node_route_by_id
from ..plugins.plugin_registry import dispatch_hook
from ..streaming.runtime_events import (
    EVENT_FLOW_NODE_COMPLETED,
    EVENT_FLOW_NODE_ERROR,
    EVENT_FLOW_NODE_RESULT,
    EVENT_FLOW_NODE_STARTED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
    EVENT_RUN_STARTED,
)
from ..tools.tool_registry import get_tool_registry
from .agent_manager import get_agent_manager
from .flow_executor import run_flow
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
    import nodes  # noqa: PLC0415
    from backend.services.plugins.plugin_registry import _DEFAULT_PLUGIN_REGISTRY  # noqa: PLC0415
    from backend.services.variables.builtin_loaders import register_builtin_loaders  # noqa: PLC0415

    nodes.init(_DEFAULT_PLUGIN_REGISTRY)
    rebuild_node_route_index()
    register_builtin_loaders()
    register_webhook_routes(app)
    register_node_routes(app)


def register_webhook_routes(app: Any) -> None:
    @app.post("/webhooks/{hook_id}")
    async def webhook_handler(hook_id: str, request: Request):
        target = resolve_node_route_by_id(hook_id)
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
                yield _sse(EVENT_RUN_STARTED, {"runId": run_id})
                try:
                    async for item in run_flow(graph_data, context):
                        if isinstance(item, NodeEvent):
                            if item.event_type == "progress":
                                token = (item.data or {}).get("token", "")
                                if token:
                                    yield _sse(EVENT_RUN_CONTENT, {"content": token})
                                continue

                            if item.event_type == "agent_event":
                                payload = dict(item.data or {})
                                event_name = str(payload.pop("event", "agent_event"))
                                yield _sse(event_name, payload)
                                continue

                            if item.event_type == "result":
                                response_payload = _extract_node_response(item)
                                if response_payload is not None:
                                    services.execution.stop_run = True

                            if item.event_type == "error":
                                payload = _node_event_payload(item)
                                if payload is not None:
                                    yield _sse(payload[0], payload[1])
                                if (item.data or {}).get("on_error") == "continue":
                                    continue
                                yield _sse(
                                    EVENT_RUN_ERROR,
                                    {"error": (item.data or {}).get("error", "Unknown node error")},
                                )
                                return

                            payload = _node_event_payload(item)
                            if payload is not None:
                                yield _sse(payload[0], payload[1])
                except Exception as exc:
                    yield _sse(EVENT_RUN_ERROR, {"error": str(exc)})
                    return

                if response_payload is not None:
                    yield _sse(EVENT_RUN_COMPLETED, {"response": response_payload})
                else:
                    yield _sse(EVENT_RUN_COMPLETED, {})

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
                        response_payload = _extract_node_response(item)
                        if response_payload is not None:
                            services.execution.stop_run = True
                    if item.event_type == "error":
                        if (item.data or {}).get("on_error") != "continue":
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


        route: Any | None = None
        subpath = ""
        if match is not None:
            route, subpath = match

        registration = get_provider_node_registration(node_type)
        if registration is not None:
            route_path = route.path if route is not None else path
            route_result = _handle_provider_node_route(
                registration=registration,
                route_path=route_path,
                request=request,
                route_id=route_id,
                node_id=target.node_id,
                node_data=node_data,
                subpath=subpath,
                body=body,
            )
            if hasattr(route_result, "__await__"):
                route_result = await route_result

            if isinstance(route_result, dict) and route_result.get("_trigger_flow"):
                trigger_payload = route_result.get("payload")
                if not isinstance(trigger_payload, dict):
                    trigger_payload = {}

                response_payload = await _run_triggered_node_flow(
                    graph_data=graph_data,
                    node_id=target.node_id,
                    trigger_payload=trigger_payload,
                )
                if response_payload is None:
                    return Response(status_code=204)
                return _build_http_response(response_payload)

            if isinstance(route_result, NodeRouteResponse):
                return _build_node_route_response(route_result)

        if route is None:
            raise HTTPException(status_code=404, detail="Node route not found")

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
        return EVENT_FLOW_NODE_STARTED, {"nodeId": item.node_id, "nodeType": item.node_type}
    if item.event_type == "completed":
        return EVENT_FLOW_NODE_COMPLETED, {"nodeId": item.node_id, "nodeType": item.node_type}
    if item.event_type == "result":
        return EVENT_FLOW_NODE_RESULT, {
            "nodeId": item.node_id,
            "nodeType": item.node_type,
            "outputs": (item.data or {}).get("outputs", {}),
        }
    if item.event_type == "error":
        return EVENT_FLOW_NODE_ERROR, {
            "nodeId": item.node_id,
            "nodeType": item.node_type,
            "error": (item.data or {}).get("error", "Unknown node error"),
        }
    return None


def _extract_node_response(item: NodeEvent) -> dict[str, Any] | None:
    if item.event_type != "result":
        return None

    hook_results = dispatch_hook(
        HookType.ON_RESPONSE_EXTRACT,
        {"event": item, "node_type": item.node_type, "node_id": item.node_id, "data": item.data or {}},
    )
    for result in hook_results:
        if isinstance(result, dict):
            return result

    outputs = (item.data or {}).get("outputs", {})
    response = outputs.get("response")
    if not isinstance(response, dict):
        return None
    value = response.get("value")
    return value if isinstance(value, dict) else None


def _coerce_status_code(value: Any, *, default: int = 200) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _shape_http_response(*, status_code: int, headers: dict[str, Any], body: Any) -> Response:
    if status_code == 204:
        return Response(status_code=status_code, headers=headers)
    if isinstance(body, (str, bytes)):
        return Response(content=body, status_code=status_code, headers=headers)
    return JSONResponse(content=body, status_code=status_code, headers=headers)


def _build_http_response(response_payload: dict[str, Any]) -> Response:
    status_code = _coerce_status_code(response_payload.get("status", 200), default=200)

    headers = response_payload.get("headers")
    headers = headers if isinstance(headers, dict) else {}

    return _shape_http_response(
        status_code=status_code,
        headers=headers,
        body=response_payload.get("body"),
    )


def _build_node_route_response(response: NodeRouteResponse) -> Response:
    return _shape_http_response(
        status_code=response.status,
        headers=response.headers,
        body=response.body,
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


async def _run_triggered_node_flow(
    *,
    graph_data: dict[str, Any],
    node_id: str,
    trigger_payload: dict[str, Any],
) -> dict[str, Any] | None:
    response_payload: dict[str, Any] | None = None
    run_id = str(uuid.uuid4())
    services = types.SimpleNamespace(
        run_handle=None,
        extra_tool_ids=[],
        tool_registry=get_tool_registry(),
        chat_input=None,
        webhook=trigger_payload,
        expression_context={"trigger": trigger_payload},
        execution=types.SimpleNamespace(entry_node_ids=[node_id], stop_run=False),
    )
    context = types.SimpleNamespace(
        run_id=run_id,
        chat_id=None,
        state=types.SimpleNamespace(user_message=""),
        services=services,
    )

    async for item in run_flow(graph_data, context):
        if isinstance(item, NodeEvent) and item.event_type == "result":
            payload = _extract_node_response(item)
            if payload is not None:
                response_payload = payload
                services.execution.stop_run = True

    return response_payload


def _handle_provider_node_route(
    *,
    registration: Any,
    route_path: str,
    request: Request,
    route_id: str,
    node_id: str,
    node_data: dict[str, Any],
    subpath: str,
    body: Any,
) -> NodeRouteResponse | dict[str, Any]:
    payload = {
        "providerId": registration.provider_id,
        "pluginId": registration.plugin_id,
        "nodeType": registration.node_type,
        "routeId": route_id,
        "routePath": route_path,
        "request": {
            "method": request.method,
            "path": request.url.path,
            "query": dict(request.query_params),
            "headers": dict(request.headers),
            "body": body,
            "subpath": subpath,
        },
        "node": {
            "id": node_id,
            "data": node_data,
        },
    }
    result = handle_provider_route(registration.runtime_spec, payload)

    mode = str(result.get("mode") or "response").strip().lower()
    if mode == "trigger_flow":
        trigger_payload = result.get("payload")
        if not isinstance(trigger_payload, dict):
            trigger_payload = {}
        return {"_trigger_flow": True, "payload": trigger_payload}

    status_code = _coerce_status_code(result.get("status", 200), default=200)

    headers = result.get("headers")
    if not isinstance(headers, dict):
        headers = {}

    return NodeRouteResponse(
        status=status_code,
        headers={str(k): str(v) for k, v in headers.items()},
        body=result.get("body"),
    )
