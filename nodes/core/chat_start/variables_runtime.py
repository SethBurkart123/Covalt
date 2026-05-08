"""Pure helpers for chat-start: spec collection, value validation, visibility."""

from __future__ import annotations

import logging
import math
from collections.abc import Callable, Iterable
from typing import Any, NamedTuple

from nodes._variables import (
    VariableSpec,
    node_model_variable_id,
    variable_spec_from_dict,
    variable_spec_to_dict,
)

MAX_VARIABLES = 100

logger = logging.getLogger(__name__)


ContributorTarget = tuple[dict[str, Any], bool]
TargetIter = Callable[[], Iterable[ContributorTarget]]
ExecutorLookup = Callable[[str], Any | None]


def find_chat_start_node(graph_data: dict[str, Any]) -> dict[str, Any] | None:
    nodes = graph_data.get("nodes") if isinstance(graph_data, dict) else None
    if not isinstance(nodes, list):
        return None
    return next(
        (n for n in nodes if isinstance(n, dict) and n.get("type") == "chat-start"),
        None,
    )


def iter_chat_start_targets_from_graph(
    graph_data: dict[str, Any],
    chat_start_id: str,
) -> Iterable[ContributorTarget]:
    nodes = graph_data.get("nodes") if isinstance(graph_data, dict) else []
    edges = graph_data.get("edges") if isinstance(graph_data, dict) else []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return
    nodes_by_id = {n.get("id"): n for n in nodes if isinstance(n, dict) and n.get("id")}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        edge_data = edge.get("data") if isinstance(edge.get("data"), dict) else {}
        if edge_data.get("channel") != "flow":
            continue
        if edge.get("source") != chat_start_id:
            continue
        target_id = edge.get("target")
        target_node = nodes_by_id.get(target_id)
        if target_node is None:
            continue
        has_model_input = _target_has_wired_model_input(edges, target_id)
        yield target_node, has_model_input


def _target_has_wired_model_input(edges: list[Any], target_id: Any) -> bool:
    return any(
        isinstance(candidate, dict)
        and candidate.get("target") == target_id
        and (candidate.get("targetHandle") or "input") == "model"
        and (candidate.get("data") if isinstance(candidate.get("data"), dict) else {}).get("channel") == "flow"
        for candidate in edges
    )


def collect_specs_from_graph(
    graph_data: dict[str, Any],
    *,
    get_executor: ExecutorLookup,
) -> tuple[list[VariableSpec], str | None]:
    """Canonical merge used by both the executor and the commands layer."""
    chat_start = find_chat_start_node(graph_data)
    if chat_start is None:
        return [], None
    chat_start_id = chat_start.get("id")
    chat_start_data = chat_start.get("data") if isinstance(chat_start.get("data"), dict) else {}

    def targets() -> Iterable[ContributorTarget]:
        return iter_chat_start_targets_from_graph(graph_data, str(chat_start_id))

    merged = _resolve_specs(chat_start_data, targets, get_executor)
    return merged, str(chat_start_id) if isinstance(chat_start_id, str) else None


def collect_specs_from_runtime(
    chat_start_data: dict[str, Any],
    runtime: Any,
    chat_start_id: str,
) -> list[VariableSpec]:
    if runtime is None:
        return parse_specs(chat_start_data.get("variables"))

    def targets() -> Iterable[ContributorTarget]:
        for edge in runtime.outgoing_edges(chat_start_id, channel="flow"):
            target_id = edge.get("target")
            if not isinstance(target_id, str):
                continue
            try:
                target_node = runtime.get_node(target_id)
            except ValueError:
                continue
            has_model_input = bool(
                runtime.incoming_edges(target_id, channel="flow", target_handle="model")
            )
            yield target_node, has_model_input

    return _resolve_specs(chat_start_data, targets, runtime.get_executor)


def _resolve_specs(
    chat_start_data: dict[str, Any],
    iter_targets: TargetIter,
    get_executor: ExecutorLookup,
) -> list[VariableSpec]:
    disabled = parse_disabled_set(chat_start_data.get("disabledContributedVars"))
    own = [s for s in parse_specs(chat_start_data.get("variables")) if s.id not in disabled]
    contributed = _collect_contributed(iter_targets, get_executor, own, disabled)
    return own + contributed


def _collect_contributed(
    iter_targets: TargetIter,
    get_executor: ExecutorLookup,
    own_specs: list[VariableSpec],
    disabled: set[str],
) -> list[VariableSpec]:
    seen = {spec.id for spec in own_specs}
    contributed: list[VariableSpec] = []
    for target_node, has_model_input in iter_targets():
        if has_model_input:
            continue
        node_type = target_node.get("type") if isinstance(target_node.get("type"), str) else None
        if not node_type:
            continue
        executor_obj = get_executor(node_type)
        declare = getattr(executor_obj, "declare_variables", None) if executor_obj else None
        if not callable(declare):
            continue
        for spec in _declared_specs_for(target_node, declare):
            spec_id = _node_scoped_spec_id(spec.id, target_node, node_type)
            if spec_id in seen or spec_id in disabled:
                continue
            spec.id = spec_id
            spec.contributed_by = _contributor_label(target_node, node_type)
            contributed.append(spec)
            seen.add(spec_id)
    return contributed


def _declared_specs_for(
    target_node: dict[str, Any],
    declare: Callable[..., Any],
) -> list[VariableSpec]:
    target_id = str(target_node.get("id") or "")
    try:
        declared = declare(target_node.get("data") or {}, None) or []
    except Exception:
        logger.exception("declare_variables failed for node %s", target_id)
        return []
    if not isinstance(declared, list):
        return []
    parsed: list[VariableSpec] = []
    for raw in declared:
        try:
            parsed.append(variable_spec_from_dict(raw))
        except Exception:
            continue
    return parsed


def _node_scoped_spec_id(
    spec_id: str,
    target_node: dict[str, Any],
    node_type: str,
) -> str:
    if node_type == "agent" and spec_id == "model":
        return node_model_variable_id(str(target_node.get("id") or ""))
    return spec_id


def _contributor_label(target_node: dict[str, Any], node_type: str) -> str | None:
    data = target_node.get("data") if isinstance(target_node.get("data"), dict) else {}
    label = data.get("name") or node_type
    return str(label) if label else None


def parse_specs(raw: Any) -> list[VariableSpec]:
    if not isinstance(raw, list):
        return []
    parsed: list[VariableSpec] = []
    for item in raw:
        try:
            parsed.append(variable_spec_from_dict(item))
        except Exception:
            continue
    return parsed


def parse_disabled_set(raw: Any) -> set[str]:
    if not isinstance(raw, list):
        return set()
    return {str(item) for item in raw if isinstance(item, str)}


def specs_to_payload(specs: list[VariableSpec]) -> list[dict[str, Any]]:
    return [variable_spec_to_dict(spec) for spec in specs]


def filter_visible(
    specs: list[VariableSpec], values: dict[str, Any]
) -> list[VariableSpec]:
    return [spec for spec in specs if _is_visible(spec, values)]


class ValidatedValues(NamedTuple):
    values: dict[str, Any]
    extras: dict[str, Any]


def validate_values(
    specs: list[VariableSpec], submitted: dict[str, Any] | None
) -> ValidatedValues:
    """Coerce submitted variable values against the spec list.

    Unknown keys are silently dropped from values and surfaced via `extras`.
    Type mismatches fall back to the spec default. Required fields must
    resolve to a non-empty value.
    """
    if len(specs) > MAX_VARIABLES:
        raise ValueError(f"Too many variables defined: {len(specs)} > {MAX_VARIABLES}")

    provided = submitted if isinstance(submitted, dict) else {}
    by_id = {spec.id: spec for spec in specs}
    values: dict[str, Any] = {}
    missing_required: list[str] = []
    for spec in specs:
        raw = provided.get(spec.id, spec.default)
        if _is_empty_required_value(raw) and spec.required:
            missing_required.append(spec.label or spec.id)
            continue
        coerced = _coerce_value(spec, raw)
        if spec.required and _is_empty_required_value(coerced):
            missing_required.append(spec.label or spec.id)
            continue
        values[spec.id] = coerced

    if missing_required:
        missing = ", ".join(missing_required)
        raise ValueError(f"Missing required variable value(s): {missing}")

    extras = {k: v for k, v in provided.items() if k not in by_id}
    return ValidatedValues(values=values, extras=extras)


def _coerce_value(spec: VariableSpec, value: Any) -> Any:
    kind = spec.control.kind
    if kind in {"text", "text-area"}:
        return "" if value is None else str(value)
    if kind == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on"}:
                return True
            if normalized in {"false", "0", "no", "off", ""}:
                return False
        return bool(value)
    if kind in {"number", "slider"}:
        try:
            n = float(value) if value is not None else 0.0
        except (TypeError, ValueError):
            n = _numeric_default(spec.default)
        if not math.isfinite(n):
            n = 0.0
        if spec.control.min is not None:
            n = max(n, float(spec.control.min))
        if spec.control.max is not None:
            n = min(n, float(spec.control.max))
        if kind == "number" and _should_return_int(spec.control.step, n):
            return int(n)
        return n
    if kind in {"select", "searchable"}:
        if spec.control.multi:
            if isinstance(value, list):
                return list(value)
            if value is None:
                return []
            return [value]
        return value
    return value


def _should_return_int(step: float | None, value: float) -> bool:
    return step is not None and float(step).is_integer() and value.is_integer()


def _numeric_default(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _is_empty_required_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, list):
        return len(value) == 0
    if isinstance(value, float):
        return not math.isfinite(value)
    return False


def _is_visible(spec: VariableSpec, values: dict[str, Any]) -> bool:
    show_when = spec.show_when
    if not show_when:
        return True

    checks: list[bool] = []

    for rule in show_when.get("valueEquals", []) or []:
        if not isinstance(rule, dict):
            continue
        checks.append(values.get(rule.get("paramId")) == rule.get("value"))
    for rule in show_when.get("valueIn", []) or []:
        if not isinstance(rule, dict):
            continue
        candidates = rule.get("values") or []
        checks.append(values.get(rule.get("paramId")) in candidates)
    for rule in show_when.get("valueNotEquals", []) or []:
        if not isinstance(rule, dict):
            continue
        checks.append(values.get(rule.get("paramId")) != rule.get("value"))
    for rule in show_when.get("valueNotIn", []) or []:
        if not isinstance(rule, dict):
            continue
        candidates = rule.get("values") or []
        checks.append(values.get(rule.get("paramId")) not in candidates)
    for param_id in show_when.get("exists", []) or []:
        checks.append(not _is_empty_required_value(values.get(param_id)))
    for param_id in show_when.get("notExists", []) or []:
        checks.append(_is_empty_required_value(values.get(param_id)))

    if not checks:
        return True
    return all(checks)
