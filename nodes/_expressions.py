"""Expression evaluator for node parameter values.

Expressions are written in JavaScript, wrapped in {{ ... }}.
Examples:
  {{ $('Node Name').item.json.fieldPath }}
  {{ input.messages[0].content.split('/')[0] }}

Priority chain: Wire > Expression > Inline value.
Wires are already resolved by _gather_inputs. This module handles the
Expression > Inline step.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

try:
    import quickjs
except ImportError:  # pragma: no cover - optional for tests
    quickjs = None

from nodes._types import DataValue

logger = logging.getLogger(__name__)

_EXPR_PATTERN = re.compile(r"\{\{(.*?)\}\}", re.DOTALL)
_FULL_EXPR_PATTERN = re.compile(r"^\s*\{\{(.*)\}\}\s*$", re.DOTALL)
_SIMPLE_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def resolve_expressions(
    data: dict[str, Any],
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve {{ }} expressions in a node's data dict (supports nested values)."""
    return _resolve_value(data, direct_input, upstream_outputs)


def _resolve_value(
    value: Any,
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> Any:
    if isinstance(value, dict):
        return {
            key: _resolve_value(val, direct_input, upstream_outputs)
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [_resolve_value(item, direct_input, upstream_outputs) for item in value]
    if isinstance(value, str) and "{{" in value:
        return _resolve_string(value, direct_input, upstream_outputs)
    return value


def _resolve_string(
    template: str,
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> Any:
    full_match = _FULL_EXPR_PATTERN.match(template)
    if full_match:
        expression = full_match.group(1).strip()
        if _should_skip_expression(expression):
            return template
        result = _eval_js_expression(expression, direct_input, upstream_outputs)
        return "" if result is None else result

    def _replace(match: re.Match) -> str:
        expr = match.group(1).strip()
        if _should_skip_expression(expr):
            return match.group(0)
        result = _eval_js_expression(expr, direct_input, upstream_outputs)
        return _stringify(result)

    return _EXPR_PATTERN.sub(_replace, template)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    try:
        return json.dumps(value)
    except TypeError:
        return str(value)


def _eval_js_expression(
    expression: str,
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> Any:
    if not expression:
        return ""

    if quickjs is None:
        logger.warning("quickjs not available; expression '%s' skipped", expression)
        return None

    try:
        ctx = quickjs.Context()
        input_value = direct_input.value if direct_input is not None else None

        input_json = _json_dumps_safe(input_value)

        ctx.add_callable("__get_input_json", lambda: input_json)
        ctx.add_callable(
            "__get_node_json",
            lambda name: _json_dumps_safe(upstream_outputs.get(str(name))),
        )
        ctx.eval(
            """
            const __raw_input = __get_input_json();
            const input = __raw_input ? JSON.parse(__raw_input) : {};
            const $ = (name) => {
              const raw = __get_node_json(String(name));
              const node = raw ? JSON.parse(raw) : null;
              return { item: { json: (node === null || node === undefined) ? {} : node } };
            };
            """
        )
        return _convert_js_result(ctx.eval(expression))
    except Exception as exc:
        logger.warning("Expression eval failed (%s): %s", expression, exc)
        return None


def _convert_js_result(value: Any) -> Any:
    if quickjs is None:
        return value
    if isinstance(value, quickjs.Object):
        try:
            return json.loads(value.json())
        except (TypeError, json.JSONDecodeError):
            return value
    return value


def _json_dumps_safe(value: Any) -> str:
    if value is None:
        return ""
    try:
        return json.dumps(value)
    except TypeError:
        return json.dumps(str(value))


def _should_skip_expression(expression: str) -> bool:
    if not expression:
        return True
    if _SIMPLE_IDENTIFIER_PATTERN.match(expression) and expression != "input":
        return True
    return False
