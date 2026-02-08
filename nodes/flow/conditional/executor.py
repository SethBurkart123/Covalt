"""Conditional node — evaluate condition, route data to true/false port."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


def _evaluate(
    field_val: Any, operator: str, compare_val: Any, case_sensitive: bool = True
) -> bool:
    """Evaluate a condition. Returns True if condition is met."""
    if operator == "equals":
        if (
            not case_sensitive
            and isinstance(field_val, str)
            and isinstance(compare_val, str)
        ):
            return field_val.lower() == compare_val.lower()
        return field_val == compare_val

    if operator == "contains":
        if (
            not case_sensitive
            and isinstance(field_val, str)
            and isinstance(compare_val, str)
        ):
            return compare_val.lower() in field_val.lower()
        return compare_val in field_val

    if operator == "greaterThan":
        return field_val > compare_val

    if operator == "lessThan":
        return field_val < compare_val

    if operator == "startsWith":
        if (
            not case_sensitive
            and isinstance(field_val, str)
            and isinstance(compare_val, str)
        ):
            return field_val.lower().startswith(compare_val.lower())
        return str(field_val).startswith(str(compare_val))

    if operator == "endsWith":
        if (
            not case_sensitive
            and isinstance(field_val, str)
            and isinstance(compare_val, str)
        ):
            return field_val.lower().endswith(compare_val.lower())
        return str(field_val).endswith(str(compare_val))

    if operator == "exists":
        return field_val is not None

    if operator == "isEmpty":
        return not field_val

    return False


class ConditionalExecutor:
    node_type = "conditional"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        field = data.get("field", "")
        operator = data.get("operator", "equals")
        compare_val = data.get("value")
        case_sensitive = data.get("caseSensitive", True)

        input_data = inputs.get("input", DataValue("any", None))
        value = input_data.value

        # Extract field from input data (dict or object)
        field_val = None
        if isinstance(value, dict):
            field_val = value.get(field)
        elif hasattr(value, field):
            field_val = getattr(value, field)

        # Missing field → false
        if field_val is None and field and operator != "exists":
            return ExecutionResult(outputs={"false": input_data})

        condition_met = _evaluate(field_val, operator, compare_val, case_sensitive)

        if condition_met:
            return ExecutionResult(outputs={"true": input_data})
        return ExecutionResult(outputs={"false": input_data})


executor = ConditionalExecutor()
