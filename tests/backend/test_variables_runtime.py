"""Pure-function tests for nodes/core/chat_start/variables_runtime.py."""

from __future__ import annotations

import math
from typing import Any

import pytest

from nodes._variables import (
    VariableSpec,
    node_model_variable_id,
    variable_spec_from_dict,
    variable_spec_to_dict,
)
from nodes.core.chat_start.variables_runtime import (
    MAX_VARIABLES,
    collect_specs_from_graph,
    filter_visible,
    parse_disabled_set,
    parse_specs,
    specs_to_payload,
    validate_values,
)


def _spec(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "topic",
        "label": "Topic",
        "control": {"kind": "text"},
    }
    base.update(overrides)
    return base


class _AgentLikeExecutor:
    """Minimal stand-in for AgentExecutor for contributor tests."""

    def declare_variables(self, data: dict[str, Any], _ctx: Any) -> list[dict[str, Any]]:
        if data.get("disableModelVariable"):
            return []
        return [
            {
                "id": "model",
                "label": "Model",
                "control": {"kind": "searchable"},
                "default": data.get("model", ""),
            }
        ]


class _ToolsetLikeExecutor:
    """Contributor that emits a non-`model` spec id (proves no rewrite)."""

    def declare_variables(self, data: dict[str, Any], _ctx: Any) -> list[dict[str, Any]]:
        del data
        return [
            {
                "id": "max_tokens",
                "label": "Max tokens",
                "control": {"kind": "number"},
                "default": 1024,
            }
        ]


class _BrokenExecutor:
    def declare_variables(self, _data: dict[str, Any], _ctx: Any) -> list[dict[str, Any]]:
        raise RuntimeError("boom")


def _executors(**by_type: Any):
    def lookup(node_type: str) -> Any | None:
        return by_type.get(node_type)
    return lookup


def _graph(
    *,
    own_vars: list[dict[str, Any]] | None = None,
    disabled: list[str] | None = None,
    contributors: list[dict[str, Any]] | None = None,
    extra_edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    chat_start = {
        "id": "chat-start",
        "type": "chat-start",
        "data": {
            "variables": own_vars or [],
            "disabledContributedVars": disabled or [],
        },
    }
    nodes: list[dict[str, Any]] = [chat_start]
    edges: list[dict[str, Any]] = []
    for contrib in contributors or []:
        nodes.append(contrib)
        edges.append({
            "source": "chat-start",
            "target": contrib["id"],
            "data": {"channel": "flow"},
        })
    edges.extend(extra_edges or [])
    return {"nodes": nodes, "edges": edges}


class TestParseSpecs:
    def test_empty_returns_empty(self) -> None:
        assert parse_specs(None) == []
        assert parse_specs([]) == []
        assert parse_specs("garbage") == []

    def test_drops_malformed(self) -> None:
        specs = parse_specs([
            _spec(),
            "not a dict",
            {"id": "no-label", "control": {"kind": "text"}},
            {"id": "bad-control", "label": "Bad", "control": {"kind": "nope"}},
            _spec(id="num", control={"kind": "number"}),
        ])
        assert [s.id for s in specs] == ["topic", "num"]


class TestParseDisabledSet:
    def test_extracts_strings(self) -> None:
        assert parse_disabled_set(["a", "b", "a"]) == {"a", "b"}

    def test_non_list_returns_empty_set(self) -> None:
        assert parse_disabled_set(None) == set()
        assert parse_disabled_set({"a": 1}) == set()

    def test_drops_non_strings(self) -> None:
        assert parse_disabled_set(["x", 1, None, "y"]) == {"x", "y"}


class TestSpecsToPayload:
    def test_round_trips_via_to_dict(self) -> None:
        specs = parse_specs([_spec(default="hi", required=True)])
        payload = specs_to_payload(specs)
        assert payload == [variable_spec_to_dict(specs[0])]


class TestValidateValuesBasics:
    def test_empty_specs_with_unknowns_records_extras(self) -> None:
        out = validate_values([], {"junk": 1})
        assert out.values == {}
        assert out.extras == {"junk": 1}

    def test_unknown_keys_preserved_in_extras(self) -> None:
        specs = parse_specs([_spec(id="t", control={"kind": "text"})])
        out = validate_values(specs, {"t": "v", "x": 9})
        assert out.values["t"] == "v"
        assert out.extras == {"x": 9}

    def test_no_unknowns_yields_empty_extras(self) -> None:
        specs = parse_specs([_spec(id="t", control={"kind": "text"})])
        out = validate_values(specs, {"t": "v"})
        assert out.extras == {}

    def test_tuple_destructure(self) -> None:
        values, extras = validate_values([], {"junk": 1})
        assert values == {}
        assert extras == {"junk": 1}

    def test_default_used_when_value_missing(self) -> None:
        specs = parse_specs([_spec(id="t", default="fallback")])
        out = validate_values(specs, {})
        assert out.values["t"] == "fallback"

    def test_required_missing_raises(self) -> None:
        specs = parse_specs([_spec(id="t", required=True)])
        with pytest.raises(ValueError, match="Missing required"):
            validate_values(specs, {})

    def test_required_multiple_missing_lists_all(self) -> None:
        specs = parse_specs([
            _spec(id="a", label="Alpha", required=True),
            _spec(id="b", label="Beta", required=True),
        ])
        with pytest.raises(ValueError) as exc:
            validate_values(specs, {})
        message = str(exc.value)
        assert "Alpha" in message
        assert "Beta" in message

    def test_too_many_specs_raises(self) -> None:
        specs = parse_specs([_spec(id=f"v{i}") for i in range(MAX_VARIABLES + 1)])
        with pytest.raises(ValueError, match="Too many variables"):
            validate_values(specs, {})


class TestCoercionMatrix:
    def test_text_stringifies(self) -> None:
        specs = parse_specs([_spec(id="t", control={"kind": "text"})])
        assert validate_values(specs, {"t": 42}).values["t"] == "42"
        assert validate_values(specs, {"t": None}).values["t"] == ""

    def test_text_area_stringifies(self) -> None:
        specs = parse_specs([_spec(id="t", control={"kind": "text-area"})])
        assert validate_values(specs, {"t": 7}).values["t"] == "7"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            (True, True),
            (False, False),
            ("true", True),
            ("YES", True),
            ("1", True),
            ("on", True),
            ("false", False),
            ("no", False),
            ("0", False),
            ("", False),
            (1, True),
            (0, False),
        ],
    )
    def test_boolean_coerces(self, raw: Any, expected: bool) -> None:
        specs = parse_specs([_spec(id="b", control={"kind": "boolean"})])
        assert validate_values(specs, {"b": raw}).values["b"] is expected

    def test_number_preserves_decimal_when_no_step(self) -> None:
        specs = parse_specs([_spec(id="n", control={"kind": "number"})])
        assert validate_values(specs, {"n": 0.7}).values["n"] == 0.7

    def test_number_returns_int_when_step_is_integer_and_value_integer(self) -> None:
        specs = parse_specs([_spec(id="n", control={"kind": "number", "step": 1})])
        out = validate_values(specs, {"n": 5}).values["n"]
        assert out == 5
        assert isinstance(out, int)

    def test_number_keeps_float_when_step_integer_but_value_decimal(self) -> None:
        specs = parse_specs([_spec(id="n", control={"kind": "number", "step": 1})])
        out = validate_values(specs, {"n": 0.7}).values["n"]
        assert isinstance(out, float)
        assert out == 0.7

    def test_number_invalid_falls_back_to_default(self) -> None:
        specs = parse_specs([
            _spec(id="n", control={"kind": "number"}, default=12.5),
        ])
        out = validate_values(specs, {"n": "not-a-number"}).values["n"]
        assert out == 12.5

    def test_number_non_finite_becomes_zero(self) -> None:
        specs = parse_specs([_spec(id="n", control={"kind": "number"})])
        out = validate_values(specs, {"n": float("inf")}).values["n"]
        assert out == 0
        out_nan = validate_values(specs, {"n": float("nan")}).values["n"]
        assert out_nan == 0
        assert not math.isnan(out_nan)

    def test_slider_clamps_to_min_max(self) -> None:
        specs = parse_specs([
            _spec(id="s", control={"kind": "slider", "min": 0, "max": 10}),
        ])
        assert validate_values(specs, {"s": -5}).values["s"] == 0.0
        assert validate_values(specs, {"s": 99}).values["s"] == 10.0
        assert validate_values(specs, {"s": 4.5}).values["s"] == 4.5

    def test_select_single_passes_through(self) -> None:
        specs = parse_specs([_spec(id="c", control={"kind": "select"})])
        assert validate_values(specs, {"c": "alpha"}).values["c"] == "alpha"

    def test_select_multi_non_list_wraps_to_list(self) -> None:
        specs = parse_specs([
            _spec(id="c", control={"kind": "select", "multi": True}),
        ])
        assert validate_values(specs, {"c": "alpha"}).values["c"] == ["alpha"]

    def test_select_multi_none_becomes_empty(self) -> None:
        specs = parse_specs([
            _spec(id="c", control={"kind": "select", "multi": True}),
        ])
        assert validate_values(specs, {"c": None}).values["c"] == []

    def test_select_multi_list_preserved(self) -> None:
        specs = parse_specs([
            _spec(id="c", control={"kind": "select", "multi": True}),
        ])
        assert validate_values(specs, {"c": ["a", "b"]}).values["c"] == ["a", "b"]

    def test_searchable_single_passes_through(self) -> None:
        specs = parse_specs([_spec(id="m", control={"kind": "searchable"})])
        assert validate_values(specs, {"m": "openai:gpt-4"}).values["m"] == "openai:gpt-4"

    def test_searchable_multi_non_list_wraps_to_list(self) -> None:
        specs = parse_specs([
            _spec(id="m", control={"kind": "searchable", "multi": True}),
        ])
        assert validate_values(specs, {"m": "openai:gpt-4"}).values["m"] == ["openai:gpt-4"]

    def test_searchable_multi_none_becomes_empty(self) -> None:
        specs = parse_specs([
            _spec(id="m", control={"kind": "searchable", "multi": True}),
        ])
        assert validate_values(specs, {"m": None}).values["m"] == []


class TestFilterVisible:
    def _spec_with_show_when(self, show_when: dict[str, Any]) -> VariableSpec:
        return variable_spec_from_dict(_spec(id="dep", show_when=show_when))

    def test_no_rules_visible(self) -> None:
        spec = variable_spec_from_dict(_spec(id="x"))
        assert filter_visible([spec], {}) == [spec]

    def test_value_equals_true(self) -> None:
        spec = self._spec_with_show_when(
            {"valueEquals": [{"paramId": "mode", "value": "advanced"}]}
        )
        assert filter_visible([spec], {"mode": "advanced"}) == [spec]
        assert filter_visible([spec], {"mode": "basic"}) == []

    def test_value_in(self) -> None:
        spec = self._spec_with_show_when(
            {"valueIn": [{"paramId": "kind", "values": ["a", "b"]}]}
        )
        assert filter_visible([spec], {"kind": "a"}) == [spec]
        assert filter_visible([spec], {"kind": "z"}) == []

    def test_value_not_equals(self) -> None:
        spec = self._spec_with_show_when(
            {"valueNotEquals": [{"paramId": "mode", "value": "off"}]}
        )
        assert filter_visible([spec], {"mode": "on"}) == [spec]
        assert filter_visible([spec], {"mode": "off"}) == []

    def test_value_not_in(self) -> None:
        spec = self._spec_with_show_when(
            {"valueNotIn": [{"paramId": "kind", "values": ["x", "y"]}]}
        )
        assert filter_visible([spec], {"kind": "a"}) == [spec]
        assert filter_visible([spec], {"kind": "x"}) == []

    def test_exists(self) -> None:
        spec = self._spec_with_show_when({"exists": ["q"]})
        assert filter_visible([spec], {"q": "non-empty"}) == [spec]
        assert filter_visible([spec], {"q": ""}) == []
        assert filter_visible([spec], {}) == []

    def test_not_exists(self) -> None:
        spec = self._spec_with_show_when({"notExists": ["q"]})
        assert filter_visible([spec], {}) == [spec]
        assert filter_visible([spec], {"q": "set"}) == []

    def test_missing_dependency_treated_as_not_present(self) -> None:
        spec = self._spec_with_show_when(
            {"valueEquals": [{"paramId": "absent", "value": "x"}]}
        )
        assert filter_visible([spec], {}) == []

    def test_multiple_rules_must_all_match(self) -> None:
        spec = self._spec_with_show_when({
            "valueEquals": [{"paramId": "mode", "value": "adv"}],
            "exists": ["topic"],
        })
        assert filter_visible([spec], {"mode": "adv", "topic": "x"}) == [spec]
        assert filter_visible([spec], {"mode": "adv", "topic": ""}) == []
        assert filter_visible([spec], {"mode": "basic", "topic": "x"}) == []

    def test_empty_show_when_visible(self) -> None:
        spec = self._spec_with_show_when({})
        assert filter_visible([spec], {}) == [spec]


class TestCollectSpecsFromGraph:
    def test_empty_graph(self) -> None:
        specs, node_id = collect_specs_from_graph({}, get_executor=_executors())
        assert specs == []
        assert node_id is None

    def test_no_chat_start_node(self) -> None:
        graph = {"nodes": [{"id": "x", "type": "agent", "data": {}}], "edges": []}
        specs, node_id = collect_specs_from_graph(graph, get_executor=_executors(agent=_AgentLikeExecutor()))
        assert specs == []
        assert node_id is None

    def test_only_own_specs(self) -> None:
        own = [_spec(id="topic", default="x")]
        graph = _graph(own_vars=own)
        specs, node_id = collect_specs_from_graph(graph, get_executor=_executors())
        assert [s.id for s in specs] == ["topic"]
        assert node_id == "chat-start"

    def test_only_contributed_specs_with_agent_id_rewrite(self) -> None:
        contributors = [{
            "id": "agent-a",
            "type": "agent",
            "data": {"name": "Alpha", "model": "openai:gpt-4"},
        }]
        graph = _graph(contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(agent=_AgentLikeExecutor()),
        )
        assert len(specs) == 1
        assert specs[0].id == node_model_variable_id("agent-a")
        assert specs[0].default == "openai:gpt-4"
        assert specs[0].contributed_by == "Alpha"

    def test_non_agent_contributor_id_not_rewritten(self) -> None:
        contributors = [{
            "id": "tool-a",
            "type": "toolset",
            "data": {"name": "Toolbox"},
        }]
        graph = _graph(contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(toolset=_ToolsetLikeExecutor()),
        )
        assert len(specs) == 1
        assert specs[0].id == "max_tokens"
        assert specs[0].contributed_by == "Toolbox"

    def test_own_and_contributed_with_overlap_dedups(self) -> None:
        own = [_spec(id="max_tokens", label="My Tokens")]
        contributors = [{
            "id": "tool-a",
            "type": "toolset",
            "data": {"name": "Toolbox"},
        }]
        graph = _graph(own_vars=own, contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(toolset=_ToolsetLikeExecutor()),
        )
        ids = [s.id for s in specs]
        assert ids == ["max_tokens"]
        assert specs[0].label == "My Tokens"
        assert specs[0].contributed_by is None

    def test_disabled_set_skips_contributor(self) -> None:
        contributors = [{
            "id": "tool-a",
            "type": "toolset",
            "data": {"name": "Toolbox"},
        }]
        graph = _graph(disabled=["max_tokens"], contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(toolset=_ToolsetLikeExecutor()),
        )
        assert specs == []

    def test_disabled_set_skips_own_spec(self) -> None:
        own = [_spec(id="topic"), _spec(id="hidden")]
        graph = _graph(own_vars=own, disabled=["hidden"])
        specs, _ = collect_specs_from_graph(graph, get_executor=_executors())
        assert [s.id for s in specs] == ["topic"]

    def test_contributor_skipped_when_target_has_wired_model_input(self) -> None:
        contributors = [{
            "id": "agent-a",
            "type": "agent",
            "data": {"name": "Alpha", "model": "openai:gpt-4"},
        }]
        extra_edges = [{
            "source": "upstream",
            "target": "agent-a",
            "targetHandle": "model",
            "data": {"channel": "flow"},
        }]
        graph = _graph(contributors=contributors, extra_edges=extra_edges)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(agent=_AgentLikeExecutor()),
        )
        assert specs == []

    def test_executor_raising_in_declare_is_swallowed(self) -> None:
        contributors = [{
            "id": "broken",
            "type": "broken",
            "data": {"name": "Broken"},
        }]
        graph = _graph(contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(broken=_BrokenExecutor()),
        )
        assert specs == []

    def test_unknown_executor_returns_no_contribution(self) -> None:
        contributors = [{
            "id": "mystery",
            "type": "no-such-executor",
            "data": {},
        }]
        graph = _graph(contributors=contributors)
        specs, _ = collect_specs_from_graph(graph, get_executor=_executors())
        assert specs == []

    def test_disable_model_variable_data_returns_empty(self) -> None:
        contributors = [{
            "id": "agent-a",
            "type": "agent",
            "data": {"name": "Alpha", "disableModelVariable": True},
        }]
        graph = _graph(contributors=contributors)
        specs, _ = collect_specs_from_graph(
            graph,
            get_executor=_executors(agent=_AgentLikeExecutor()),
        )
        assert specs == []
