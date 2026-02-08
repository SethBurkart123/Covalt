"""Type coercion for DataValues flowing through edges.

Mirrors the IMPLICIT_COERCIONS table in app/lib/flow/sockets.ts.
That table gates editor-time connections; this module performs the actual
runtime conversion when a DataValue arrives at a port with a different type.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from nodes._types import DataValue


# ── Conversion functions ─────────────────────────────────────────────
# Each takes a DataValue and returns a new DataValue with the target type.
# They assume the source type is correct (the table only maps valid pairs).


def _identity(target: str) -> Callable[[DataValue], DataValue]:
    return lambda v: DataValue(type=target, value=v.value)


def _int_to_float(v: DataValue) -> DataValue:
    return DataValue(type="float", value=float(v.value))


def _to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value=str(v.value))


def _bool_to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value="true" if v.value else "false")


def _json_to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value=json.dumps(v.value, separators=(",", ":")))


def _json_to_text(v: DataValue) -> DataValue:
    return DataValue(type="text", value=json.dumps(v.value, indent=2))


def _message_to_text(v: DataValue) -> DataValue:
    content = v.value.get("content", "") if isinstance(v.value, dict) else str(v.value)
    return DataValue(type="text", value=content)


def _message_to_string(v: DataValue) -> DataValue:
    content = v.value.get("content", "") if isinstance(v.value, dict) else str(v.value)
    return DataValue(type="string", value=content)


def _message_to_json(v: DataValue) -> DataValue:
    if isinstance(v.value, dict):
        return DataValue(type="json", value=v.value)
    return DataValue(type="json", value={"content": str(v.value)})


def _document_to_text(v: DataValue) -> DataValue:
    text = v.value.get("text", "") if isinstance(v.value, dict) else str(v.value)
    return DataValue(type="text", value=text)


def _document_to_json(v: DataValue) -> DataValue:
    if isinstance(v.value, dict):
        return DataValue(type="json", value=v.value)
    return DataValue(type="json", value={"text": str(v.value)})


# ── Coercion table ──────────────────────────────────────────────────
# (source_type, target_type) → converter function
# Keep in sync with IMPLICIT_COERCIONS in sockets.ts.

COERCION_TABLE: dict[tuple[str, str], Callable[[DataValue], DataValue]] = {
    # Numeric widening
    ("int", "float"): _int_to_float,
    # Primitives → string
    ("int", "string"): _to_string,
    ("float", "string"): _to_string,
    ("boolean", "string"): _bool_to_string,
    # string ↔ text (identity)
    ("string", "text"): _identity("text"),
    ("text", "string"): _identity("string"),
    # Structured → string/text
    ("json", "string"): _json_to_string,
    ("json", "text"): _json_to_text,
    # Message unpacking
    ("message", "text"): _message_to_text,
    ("message", "string"): _message_to_string,
    ("message", "json"): _message_to_json,
    # Document unpacking
    ("document", "text"): _document_to_text,
    ("document", "json"): _document_to_json,
}


def can_coerce(source_type: str, target_type: str) -> bool:
    """Check if source_type can implicitly convert to target_type."""
    if source_type == target_type:
        return True
    if target_type == "any" or source_type == "any":
        return True
    return (source_type, target_type) in COERCION_TABLE


def coerce(value: DataValue, target_type: str) -> DataValue:
    """Convert a DataValue to target_type, returning a new DataValue.

    Returns the original if types already match.
    Raises TypeError if no coercion path exists.
    """
    if value.type == target_type:
        return value

    # any accepts everything as-is; any-typed values pass through to any target
    if target_type == "any":
        return value
    if value.type == "any":
        return DataValue(type=target_type, value=value.value)

    converter = COERCION_TABLE.get((value.type, target_type))
    if converter is None:
        raise TypeError(
            f"No implicit coercion from '{value.type}' to '{target_type}'. "
            f"Use a Type Converter node for explicit conversion."
        )
    return converter(value)
