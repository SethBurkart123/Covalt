"""Code node — execute custom JavaScript and return its result."""

from __future__ import annotations

import json
from typing import Any

try:
    import quickjs
except ImportError:  # pragma: no cover - optional for tests
    quickjs = None

from nodes._types import DataValue, ExecutionResult, FlowContext


def _json_dumps_safe(value: Any) -> str:
    if value is None:
        return ""
    try:
        return json.dumps(value)
    except TypeError:
        return json.dumps(str(value))


def _convert_js_result(value: Any) -> Any:
    if quickjs is None:
        return value
    if isinstance(value, quickjs.Object):
        try:
            return json.loads(value.json())
        except (TypeError, json.JSONDecodeError):
            return str(value)
    return value


def _ensure_json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        return json.loads(_json_dumps_safe(value))


def _eval_js(
    code: str,
    *,
    input_value: Any,
    trigger_value: Any,
    upstream_outputs: dict[str, Any],
) -> Any:
    if quickjs is None:
        raise RuntimeError("quickjs is not available; cannot execute JavaScript")

    ctx = quickjs.Context()

    input_json = _json_dumps_safe(input_value)
    trigger_json = _json_dumps_safe(trigger_value)

    ctx.add_callable("__get_input_json", lambda: input_json)
    ctx.add_callable("__get_trigger_json", lambda: trigger_json)
    ctx.add_callable(
        "__get_node_json",
        lambda name: _json_dumps_safe(upstream_outputs.get(str(name))),
    )

    ctx.eval(
        """
        const __raw_input = __get_input_json();
        const input = __raw_input ? JSON.parse(__raw_input) : {};
        const $input = input;
        const __raw_trigger = __get_trigger_json();
        const trigger = __raw_trigger ? JSON.parse(__raw_trigger) : {};
        const $trigger = trigger;
        const $ = (name) => {
          const raw = __get_node_json(String(name));
          const node = raw ? JSON.parse(raw) : null;
          return { item: { json: (node === null || node === undefined) ? {} : node } };
        };
        """
    )

    wrapped = f"(function() {{\n{code}\n}})()"
    return _ensure_json_safe(_convert_js_result(ctx.eval(wrapped)))


class CodeExecutor:
    node_type = "code"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        code = str(data.get("code") or "")
        input_value = inputs.get("input", DataValue("data", {})).value

        if not code.strip():
            return ExecutionResult(outputs={"output": DataValue(type="data", value=input_value)})

        services = getattr(context, "services", None)
        expression_context = getattr(services, "expression_context", None)
        trigger_value = (
            expression_context.get("trigger")
            if isinstance(expression_context, dict)
            else None
        )

        upstream_outputs: dict[str, Any] = {}
        if services is not None:
            maybe_outputs = getattr(services, "upstream_outputs", None)
            if isinstance(maybe_outputs, dict):
                upstream_outputs = maybe_outputs

        result = _eval_js(
            code,
            input_value=input_value,
            trigger_value=trigger_value,
            upstream_outputs=upstream_outputs,
        )

        return ExecutionResult(outputs={"output": DataValue(type="data", value=result)})


executor = CodeExecutor()
