"""Tests for the type coercion system (nodes/_coerce.py).

Covers every entry in COERCION_TABLE, identity passthrough,
and error cases for invalid coercions.

8-type system: agent, tools, float, int, string, boolean, json, model
"""

from __future__ import annotations

import json

import pytest

from nodes._coerce import COERCION_TABLE, can_coerce, coerce
from nodes._types import DataValue


# ── can_coerce ───────────────────────────────────────────────────────


class TestCanCoerce:
    """can_coerce checks the coercion table + identity."""

    def test_identity_always_true(self):
        for t in ("int", "float", "string", "json", "boolean", "model"):
            assert can_coerce(t, t) is True

    @pytest.mark.parametrize(
        "src,tgt",
        list(COERCION_TABLE.keys()),
        ids=[f"{s}->{t}" for s, t in COERCION_TABLE],
    )
    def test_table_entries(self, src: str, tgt: str):
        assert can_coerce(src, tgt) is True

    def test_invalid_pairs(self):
        assert can_coerce("boolean", "float") is False
        assert can_coerce("tools", "string") is False
        assert can_coerce("tools", "json") is False
        assert can_coerce("model", "int") is False
        assert can_coerce("json", "boolean") is False

    def test_any_is_not_a_supported_socket_type(self):
        assert can_coerce("any", "string") is False
        assert can_coerce("string", "any") is False


# ── coerce ───────────────────────────────────────────────────────────


class TestCoerce:
    """coerce performs the actual runtime conversion."""

    def test_identity_returns_same(self):
        v = DataValue(type="string", value="hello")
        assert coerce(v, "string") is v

    # -- Numeric widening --

    def test_int_to_float(self):
        result = coerce(DataValue(type="int", value=42), "float")
        assert result.type == "float"
        assert result.value == 42.0
        assert isinstance(result.value, float)

    # -- Primitives → string --

    def test_int_to_string(self):
        result = coerce(DataValue(type="int", value=7), "string")
        assert result == DataValue(type="string", value="7")

    def test_float_to_string(self):
        result = coerce(DataValue(type="float", value=3.14), "string")
        assert result == DataValue(type="string", value="3.14")

    def test_boolean_to_string_true(self):
        result = coerce(DataValue(type="boolean", value=True), "string")
        assert result == DataValue(type="string", value="true")

    def test_boolean_to_string_false(self):
        result = coerce(DataValue(type="boolean", value=False), "string")
        assert result == DataValue(type="string", value="false")

    # -- json → string --

    def test_json_to_string(self):
        result = coerce(DataValue(type="json", value={"a": 1}), "string")
        assert result.type == "string"
        assert json.loads(result.value) == {"a": 1}
        # Compact format (no spaces)
        assert " " not in result.value

    # -- errors --

    def test_invalid_coercion_raises_type_error(self):
        with pytest.raises(TypeError, match="No implicit coercion"):
            coerce(DataValue(type="boolean", value=True), "float")

    def test_tools_to_string_raises(self):
        with pytest.raises(TypeError, match="No implicit coercion"):
            coerce(DataValue(type="tools", value="x"), "string")

    def test_any_to_string_raises(self):
        with pytest.raises(TypeError, match="No implicit coercion"):
            coerce(DataValue(type="any", value="x"), "string")
