"""Prompt Template node — {{variable}} interpolation into a template string."""

from __future__ import annotations

import re
from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext

# Matches {{variableName}} with optional whitespace inside braces
_VAR_PATTERN = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class PromptTemplateExecutor:
    node_type = "prompt-template"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        template = data.get("template", "")
        undefined_behavior = data.get("undefinedBehavior", "empty")
        variables = inputs.get("input", DataValue("data", {})).value or {}

        def _replace(match: re.Match) -> str:
            key = match.group(1)
            if key in variables:
                return str(variables[key])

            if undefined_behavior == "keep":
                return match.group(0)
            if undefined_behavior == "error":
                raise ValueError(f"Undefined template variable: {key}")
            # default: "empty"
            return ""

        rendered = _VAR_PATTERN.sub(_replace, template)

        return ExecutionResult(
            outputs={"output": DataValue(type="data", value={"text": rendered})}
        )


executor = PromptTemplateExecutor()
