"""Merge node — combine multiple inputs into a single array."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


def _parse_index(handle_id: str) -> int | None:
    if handle_id == "input":
        return 1
    if not handle_id.startswith("input_"):
        return None
    raw = handle_id.split("_", 1)[1]
    try:
        index = int(raw)
    except ValueError:
        return None
    if index < 1:
        return None
    return index


class MergeExecutor:
    node_type = "merge"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        ordered: list[tuple[int, DataValue]] = []
        for handle_id, value in inputs.items():
            index = _parse_index(handle_id)
            if index is None:
                continue
            ordered.append((index, value))

        ordered.sort(key=lambda pair: pair[0])
        merged = [value.value for _, value in ordered]

        return ExecutionResult(outputs={"output": DataValue(type="data", value=merged)})


executor = MergeExecutor()
