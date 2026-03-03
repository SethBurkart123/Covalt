
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


def _output_snippet(value: str | None, *, limit: int = 240) -> str:
    raw = (value or '').strip()
    if not raw:
        return ''

    normalized = raw.replace('\r', '').replace('\n', '\\n')
    if len(normalized) <= limit:
        return normalized
    return f'{normalized[:limit]}…'


def _rpc_error_message(
    spec: NodeProviderRuntimeSpec,
    *,
    method: str,
    summary: str,
    stderr: str | None = None,
    output: str | None = None,
) -> str:
    parts = [
        f"Node provider runtime '{spec.plugin_id}' method '{method}' {summary}",
    ]

    stderr_snippet = _output_snippet(stderr)
    if stderr_snippet:
        parts.append(f'stderr: {stderr_snippet}')

    output_snippet = _output_snippet(output)
    if output_snippet:
        parts.append(f'output: {output_snippet}')

    return ' | '.join(parts)


def _runtime_error(
    spec: NodeProviderRuntimeSpec,
    *,
    method: str,
    summary: str,
    stderr: str | None = None,
    output: str | None = None,
) -> NodeProviderRuntimeError:
    return NodeProviderRuntimeError(
        _rpc_error_message(
            spec,
            method=method,
            summary=summary,
            stderr=stderr,
            output=output,
        )
    )


def _extract_envelope_error_message(error_payload: Any) -> str:
    if isinstance(error_payload, dict):
        message = error_payload.get('message')
        if isinstance(message, str) and message.strip():
            return message.strip()

    if isinstance(error_payload, str) and error_payload.strip():
        return error_payload.strip()

    if error_payload is None:
        return 'unknown provider runtime error'

    return str(error_payload)


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

    stderr = proc.stderr or ''
    raw_stdout = proc.stdout or ''

    if proc.returncode != 0:
        raise _runtime_error(
            spec,
            method=method,
            summary=f'failed with exit code {proc.returncode}',
            stderr=stderr,
            output=raw_stdout,
        )

    raw = raw_stdout.strip()
    if not raw:
        raise _runtime_error(
            spec,
            method=method,
            summary='returned empty response',
            stderr=stderr,
        )

    try:
        data = json.loads(raw)
    except Exception as exc:
        raise _runtime_error(
            spec,
            method=method,
            summary='returned invalid JSON',
            stderr=stderr,
            output=raw,
        ) from exc

    if not isinstance(data, dict):
        raise _runtime_error(
            spec,
            method=method,
            summary='returned non-object envelope (expected JSON object)',
            stderr=stderr,
            output=raw,
        )

    if data.get('ok') is False:
        error_message = _extract_envelope_error_message(data.get('error'))
        raise _runtime_error(
            spec,
            method=method,
            summary=f"returned error envelope: {error_message}",
            stderr=stderr,
            output=raw,
        )

    result = data.get('result')
    if not isinstance(result, dict):
        raise _runtime_error(
            spec,
            method=method,
            summary='returned invalid result shape (expected object at result)',
            stderr=stderr,
            output=raw,
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
