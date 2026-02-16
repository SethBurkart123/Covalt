"""Reroute node — pass-through for flow and link edges."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


def _infer_socket_type(data: dict[str, Any]) -> str:
    socket_type = data.get("_socketType")
    if isinstance(socket_type, str) and socket_type:
        return socket_type
    return "data"


class RerouteExecutor:
    node_type = "reroute"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        value = inputs.get("input")
        if value is not None:
            return ExecutionResult(outputs={"output": value})

        fallback = data.get("value")
        if fallback is None:
            return ExecutionResult(outputs={})

        return ExecutionResult(
            outputs={"output": DataValue(type=_infer_socket_type(data), value=fallback)}
        )

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any:
        if output_handle != "output":
            raise ValueError(
                f"reroute node cannot materialize unknown output handle: {output_handle}"
            )

        runtime = context.runtime
        if runtime is None:
            return None

        for edge in runtime.incoming_edges(
            context.node_id,
            channel="flow",
            target_handle="input",
        ):
            source_id = edge.get("source")
            if not source_id:
                continue
            source_handle = edge.get("sourceHandle") or "output"
            value = await runtime.materialize_output(source_id, source_handle)
            if value is not None:
                return value

        artifacts: list[Any] = []
        for edge in runtime.incoming_edges(
            context.node_id,
            channel="link",
            target_handle="input",
        ):
            source_id = edge.get("source")
            if not source_id:
                continue
            source_handle = edge.get("sourceHandle") or "output"
            artifact = await runtime.materialize_output(source_id, source_handle)
            if artifact is None:
                continue
            if isinstance(artifact, list):
                artifacts.extend(artifact)
            else:
                artifacts.append(artifact)

        if artifacts:
            return artifacts

        fallback = data.get("value")
        if fallback is not None:
            return fallback

        return None


executor = RerouteExecutor()
