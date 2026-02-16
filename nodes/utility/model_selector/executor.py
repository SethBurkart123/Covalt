"""Model Selector node — pass-through for model identifiers."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class ModelSelectorExecutor:
    node_type = "model-selector"

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> str:
        if output_handle not in {"output", "model"}:
            raise ValueError(
                "model-selector node cannot materialize unknown output handle: "
                f"{output_handle}"
            )

        linked_model = await _resolve_upstream_model(context)
        if linked_model:
            return linked_model
        return str(data.get("model", ""))

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        # Wire input wins over inline value
        model = inputs.get("model", DataValue("model", "")).value or data.get(
            "model", ""
        )
        return ExecutionResult(outputs={"output": DataValue(type="model", value=model)})


async def _resolve_upstream_model(context: FlowContext) -> str:
    runtime = context.runtime
    if runtime is None:
        return ""

    for edge in runtime.incoming_edges(
        context.node_id,
        channel="flow",
        target_handle="model",
    ):
        source_id = edge.get("source")
        if not source_id:
            continue

        source_handle = edge.get("sourceHandle") or "output"
        value = await runtime.materialize_output(source_id, source_handle)
        if value is None:
            continue

        text = str(value)
        if text:
            return text

    return ""


executor = ModelSelectorExecutor()
