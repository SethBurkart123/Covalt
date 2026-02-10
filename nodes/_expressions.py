"""Expression evaluator for node parameter values.

Two syntaxes:
  {{ $('Node Name').item.json.fieldPath }} — reference any upstream node by display name
  {{ input.fieldPath }}                    — shorthand for the direct parent's output

Priority chain: Wire > Expression > Inline value.
Wires are already resolved by _gather_inputs. This module handles the
Expression > Inline step.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from nodes._types import DataValue

logger = logging.getLogger(__name__)

# Matches {{ $('Node Name').item.json.field.path }}
_NODE_REF_PATTERN = re.compile(
    r"\{\{\s*\$\(\s*['\"]([^'\"]+)['\"]\s*\)\.item\.json(?:\.([\w.]+))?\s*\}\}"
)

# Matches {{ input.field.path }}
_INPUT_PATTERN = re.compile(r"\{\{\s*input(?:\.([\w.]+))?\s*\}\}")


def _resolve_path(obj: Any, path: str) -> Any:
    """Walk a dotted path into a nested dict/object."""
    parts = path.split(".")
    current = obj
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            return None
        if current is None:
            return None
    return current


def resolve_expressions(
    data: dict[str, Any],
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve {{ }} expressions in all string values of a node's data dict."""
    return {
        key: _resolve_string(value, direct_input, upstream_outputs)
        if isinstance(value, str) and "{{" in value
        else value
        for key, value in data.items()
    }


def _resolve_string(
    template: str,
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],
) -> str:
    result = _NODE_REF_PATTERN.sub(
        lambda m: _resolve_node_ref(m, upstream_outputs), template
    )
    return _INPUT_PATTERN.sub(lambda m: _resolve_input_ref(m, direct_input), result)


def _resolve_node_ref(match: re.Match, upstream_outputs: dict[str, Any]) -> str:
    node_name = match.group(1)
    field_path = match.group(2)

    output = upstream_outputs.get(node_name)
    if output is None:
        logger.warning("Expression references unknown node '%s'", node_name)
        return ""

    if field_path is None:
        return str(output)

    resolved = _resolve_path(output, field_path)
    return str(resolved) if resolved is not None else ""


def _resolve_input_ref(match: re.Match, direct_input: DataValue | None) -> str:
    if direct_input is None or direct_input.value is None:
        return ""

    field_path = match.group(1)
    if field_path is None:
        return str(direct_input.value)

    resolved = _resolve_path(direct_input.value, field_path)
    return str(resolved) if resolved is not None else ""
