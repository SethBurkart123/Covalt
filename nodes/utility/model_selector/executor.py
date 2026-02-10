"""Model Selector node — pass-through for model identifiers."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class ModelSelectorExecutor:
    node_type = "model-selector"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        # Wire input wins over inline value
        model = inputs.get("model", DataValue("model", "")).value or data.get(
            "model", ""
        )
        return ExecutionResult(outputs={"output": DataValue(type="model", value=model)})


executor = ModelSelectorExecutor()
