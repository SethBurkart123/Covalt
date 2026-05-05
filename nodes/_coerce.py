"""Type coercion for DataValues flowing through edges.

Mirrors the IMPLICIT_COERCIONS table in app/lib/flow/sockets.ts, which gates
editor-time connections. This module performs the actual runtime conversion when
a DataValue arrives at a port with a different type.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from nodes._types import DataValue


def _int_to_float(v: DataValue) -> DataValue:
    return DataValue(type="float", value=float(v.value))


def _to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value=str(v.value))


def _bool_to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value="true" if v.value else "false")


def _json_to_string(v: DataValue) -> DataValue:
    return DataValue(type="string", value=json.dumps(v.value, separators=(",", ":")))


COERCION_TABLE: dict[tuple[str, str], Callable[[DataValue], DataValue]] = {
    ("int", "float"): _int_to_float,
    ("int", "string"): _to_string,
    ("float", "string"): _to_string,
    ("boolean", "string"): _bool_to_string,
    ("json", "string"): _json_to_string,
}


def register_coercion(
    source_type: str,
    target_type: str,
    converter: Callable[[DataValue], DataValue],
) -> None:
    COERCION_TABLE[(source_type, target_type)] = converter


def can_coerce(source_type: str, target_type: str) -> bool:
    if source_type == target_type:
        return True
    return (source_type, target_type) in COERCION_TABLE


def coerce(value: DataValue, target_type: str) -> DataValue:
    """Convert a DataValue to target_type, returning a new DataValue.

    Returns the original if types already match.
    Raises TypeError if no coercion path exists.
    """
    if value.type == target_type:
        return value

    converter = COERCION_TABLE.get((value.type, target_type))
    if converter is None:
        raise TypeError(
            f"No implicit coercion from '{value.type}' to '{target_type}'. "
            f"Use a Type Converter node for explicit conversion."
        )
    return converter(value)
