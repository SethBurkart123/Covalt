
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class NodeProviderRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class NodeProviderRuntimeSpec:
    plugin_id: str
    provider_id: str
    plugin_dir: Path
    entrypoint: str


def _run_bun_rpc(
    spec: NodeProviderRuntimeSpec,
    *,
    method: str,
    payload: dict[str, Any] | None = None,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    req = {
        'method': method,
        'payload': payload or {},
    }

    entrypoint_path = (spec.plugin_dir / spec.entrypoint).resolve()
    if not entrypoint_path.exists():
        raise NodeProviderRuntimeError(
            f"Node provider plugin '{spec.plugin_id}' missing runtime entrypoint: {entrypoint_path}"
        )

    proc = subprocess.run(
        ['bun', str(entrypoint_path)],
        input=json.dumps(req),
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        cwd=str(spec.plugin_dir),
    )

    if proc.returncode != 0:
        stderr = (proc.stderr or '').strip()
        raise NodeProviderRuntimeError(
            f"Node provider runtime failed ({spec.plugin_id}): {stderr or 'unknown error'}"
        )

    raw = (proc.stdout or '').strip()
    if not raw:
        raise NodeProviderRuntimeError(
            f"Node provider runtime '{spec.plugin_id}' returned empty output"
        )

    try:
        data = json.loads(raw)
    except Exception as exc:
        raise NodeProviderRuntimeError(
            f"Node provider runtime '{spec.plugin_id}' returned invalid JSON"
        ) from exc

    if not isinstance(data, dict):
        raise NodeProviderRuntimeError(
            f"Node provider runtime '{spec.plugin_id}' returned non-object response"
        )

    if data.get('ok') is False:
        message = str(data.get('error') or 'unknown provider runtime error')
        raise NodeProviderRuntimeError(message)

    result = data.get('result')
    if not isinstance(result, dict):
        raise NodeProviderRuntimeError(
            f"Node provider runtime '{spec.plugin_id}' missing object result"
        )

    return result


def list_provider_definitions(
    spec: NodeProviderRuntimeSpec,
) -> list[dict[str, Any]]:
    result = _run_bun_rpc(spec, method='list_definitions', payload={})
    definitions = result.get('definitions')
    if not isinstance(definitions, list):
        raise NodeProviderRuntimeError(
            f"Node provider runtime '{spec.plugin_id}' returned invalid definitions"
        )

    normalized: list[dict[str, Any]] = []
    for item in definitions:
        if isinstance(item, dict):
            normalized.append(dict(item))
    return normalized


def execute_provider_node(
    spec: NodeProviderRuntimeSpec,
    request_payload: dict[str, Any],
) -> dict[str, Any]:
    return _run_bun_rpc(
        spec,
        method='execute',
        payload=request_payload,
        timeout_seconds=60,
    )


def materialize_provider_node(
    spec: NodeProviderRuntimeSpec,
    request_payload: dict[str, Any],
) -> dict[str, Any]:
    return _run_bun_rpc(
        spec,
        method='materialize',
        payload=request_payload,
        timeout_seconds=60,
    )


def configure_provider_runtime(
    spec: NodeProviderRuntimeSpec,
    request_payload: dict[str, Any],
) -> None:
    _run_bun_rpc(
        spec,
        method='configure_runtime',
        payload=request_payload,
        timeout_seconds=15,
    )


def handle_provider_route(
    spec: NodeProviderRuntimeSpec,
    request_payload: dict[str, Any],
) -> dict[str, Any]:
    return _run_bun_rpc(
        spec,
        method='handle_route',
        payload=request_payload,
        timeout_seconds=60,
    )
