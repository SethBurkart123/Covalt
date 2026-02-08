"""Tests for the type coercion system (nodes/_coerce.py).

Covers every entry in COERCION_TABLE, the `any` wildcard, identity passthrough,
and error cases for invalid coercions.
"""

from __future__ import annotations

import json

import pytest

from nodes._coerce import COERCION_TABLE, can_coerce, coerce
from nodes._types import DataValue


# ── can_coerce ───────────────────────────────────────────────────────


class TestCanCoerce:
    """can_coerce checks the coercion table + identity + any."""

    def test_identity_always_true(self):
        for t in (
            "int",
            "float",
            "string",
            "text",
            "json",
            "message",
            "document",
            "boolean",
        ):
            assert can_coerce(t, t) is True

    @pytest.mark.parametrize(
        "src,tgt",
        list(COERCION_TABLE.keys()),
        ids=[f"{s}->{t}" for s, t in COERCION_TABLE],
    )
    def test_table_entries(self, src: str, tgt: str):
        assert can_coerce(src, tgt) is True

    def test_any_target_accepts_everything(self):
        for src in ("int", "string", "json", "message", "binary"):
            assert can_coerce(src, "any") is True

    def test_any_source_connects_everywhere(self):
        for tgt in ("int", "string", "json", "float", "text"):
            assert can_coerce("any", tgt) is True

    def test_invalid_pairs(self):
        assert can_coerce("boolean", "float") is False
        assert can_coerce("binary", "string") is False
        assert can_coerce("vector", "int") is False
        assert can_coerce("trigger", "json") is False


# ── coerce ───────────────────────────────────────────────────────────


class TestCoerce:
    """coerce performs the actual runtime conversion."""

    def test_identity_returns_same(self):
        v = DataValue(type="text", value="hello")
        assert coerce(v, "text") is v

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

    # -- string ↔ text --

    def test_string_to_text(self):
        result = coerce(DataValue(type="string", value="abc"), "text")
        assert result == DataValue(type="text", value="abc")

    def test_text_to_string(self):
        result = coerce(DataValue(type="text", value="abc"), "string")
        assert result == DataValue(type="string", value="abc")

    # -- json → string/text --

    def test_json_to_string(self):
        result = coerce(DataValue(type="json", value={"a": 1}), "string")
        assert result.type == "string"
        assert json.loads(result.value) == {"a": 1}
        # Compact format (no spaces)
        assert " " not in result.value

    def test_json_to_text(self):
        result = coerce(DataValue(type="json", value={"a": 1}), "text")
        assert result.type == "text"
        assert json.loads(result.value) == {"a": 1}
        # Pretty format (indented)
        assert "\n" in result.value

    # -- message unpacking --

    def test_message_dict_to_text(self):
        msg = {"role": "user", "content": "hello world"}
        result = coerce(DataValue(type="message", value=msg), "text")
        assert result == DataValue(type="text", value="hello world")

    def test_message_dict_to_string(self):
        msg = {"role": "user", "content": "hi"}
        result = coerce(DataValue(type="message", value=msg), "string")
        assert result == DataValue(type="string", value="hi")

    def test_message_dict_to_json(self):
        msg = {"role": "user", "content": "hi"}
        result = coerce(DataValue(type="message", value=msg), "json")
        assert result == DataValue(type="json", value=msg)

    def test_message_non_dict_to_text(self):
        result = coerce(DataValue(type="message", value="plain text"), "text")
        assert result == DataValue(type="text", value="plain text")

    # -- document unpacking --

    def test_document_dict_to_text(self):
        doc = {"text": "doc content", "metadata": {}}
        result = coerce(DataValue(type="document", value=doc), "text")
        assert result == DataValue(type="text", value="doc content")

    def test_document_dict_to_json(self):
        doc = {"text": "content", "metadata": {"source": "test"}}
        result = coerce(DataValue(type="document", value=doc), "json")
        assert result == DataValue(type="json", value=doc)

    def test_document_non_dict_to_text(self):
        result = coerce(DataValue(type="document", value="raw"), "text")
        assert result == DataValue(type="text", value="raw")

    # -- any wildcard --

    def test_any_target_returns_original(self):
        v = DataValue(type="int", value=42)
        result = coerce(v, "any")
        assert result is v

    def test_any_source_retyped(self):
        v = DataValue(type="any", value="hello")
        result = coerce(v, "string")
        assert result == DataValue(type="string", value="hello")

    # -- errors --

    def test_invalid_coercion_raises_type_error(self):
        with pytest.raises(TypeError, match="No implicit coercion"):
            coerce(DataValue(type="boolean", value=True), "float")

    def test_binary_to_string_raises(self):
        with pytest.raises(TypeError, match="No implicit coercion"):
            coerce(DataValue(type="binary", value=b"bytes"), "string")
