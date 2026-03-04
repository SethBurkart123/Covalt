"""Prompt Template node — render a template string from input data."""

from __future__ import annotations

import re
from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext

_TEMPLATE_FIELD = re.compile(r"{{\s*([\w\.]+)\s*}}")


def _lookup(path: str, payload: Any) -> Any:
    current = payload
    for segment in path.split("."):
        if isinstance(current, dict):
            current = current.get(segment)
            continue
        return None
    return current


def _coerce_input(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    return {"value": value}


def _render_template(template: str, payload: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        looked_up = _lookup(key, payload)
        if looked_up is None:
            return ""
        return str(looked_up)

    return _TEMPLATE_FIELD.sub(replace, template)


class PromptTemplateExecutor:
    node_type = "prompt-template"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        del context

        input_value = inputs.get("input", DataValue(type="data", value={})).value
        payload = _coerce_input(input_value)

        template_input = inputs.get("template")
        template_value = (
            template_input.value if template_input is not None else data.get("template", "")
        )
        template = str(template_value or "")

        rendered = _render_template(template, payload)
        output = {
            "text": rendered,
            "template": template,
            "values": payload,
        }

        return ExecutionResult(outputs={"output": DataValue(type="data", value=output)})


executor = PromptTemplateExecutor()
