"""Type hints to JSON Schema conversion."""

from __future__ import annotations

import inspect
import re
from typing import Any, Callable, Union, get_args, get_origin, get_type_hints

try:
    from pydantic import BaseModel

    HAS_PYDANTIC = True
except ImportError:
    BaseModel = None  # type: ignore
    HAS_PYDANTIC = False


def function_to_json_schema(fn: Callable) -> dict[str, Any]:
    """Convert a function's signature and type hints to JSON Schema."""
    try:
        hints = get_type_hints(fn, include_extras=True)
    except Exception:
        hints = {}

    sig = inspect.signature(fn)
    docstring_params = _parse_docstring_params(fn.__doc__ or "")

    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls"):
            continue

        param_type = hints.get(param_name, Any)
        prop_schema = type_to_json_schema(param_type)

        if param_name in docstring_params:
            prop_schema["description"] = docstring_params[param_name]

        if param.default is not inspect.Parameter.empty:
            prop_schema["default"] = param.default
        else:
            required.append(param_name)

        properties[param_name] = prop_schema

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def type_to_json_schema(t: Any) -> dict[str, Any]:
    """Convert a Python type to JSON Schema."""
    if t is None or t is type(None):
        return {"type": "null"}

    if (
        HAS_PYDANTIC
        and BaseModel is not None
        and isinstance(t, type)
        and issubclass(t, BaseModel)
    ):
        return _pydantic_to_schema(t)

    if t is str:
        return {"type": "string"}
    if t is int:
        return {"type": "integer"}
    if t is float:
        return {"type": "number"}
    if t is bool:
        return {"type": "boolean"}
    if t is Any:
        return {}

    origin = get_origin(t)
    args = get_args(t)

    if origin is Union:
        non_none_args = [a for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            return type_to_json_schema(non_none_args[0])
        return {"anyOf": [type_to_json_schema(a) for a in args]}

    if origin is list:
        if args:
            return {"type": "array", "items": type_to_json_schema(args[0])}
        return {"type": "array"}

    if origin is dict:
        schema: dict[str, Any] = {"type": "object"}
        if len(args) >= 2:
            schema["additionalProperties"] = type_to_json_schema(args[1])
        return schema

    if origin is tuple:
        if args:
            return {"type": "array", "items": [type_to_json_schema(a) for a in args]}
        return {"type": "array"}

    return {"type": "string"}


def _pydantic_to_schema(model: type) -> dict[str, Any]:
    """Convert a Pydantic model to JSON Schema."""
    schema = model.model_json_schema()
    if "$defs" in schema:
        schema = _inline_refs(schema, schema.pop("$defs"))
    return schema


def _inline_refs(schema: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    """Recursively inline $ref references in a JSON Schema."""
    if isinstance(schema, dict):
        if "$ref" in schema:
            ref_name = schema["$ref"].split("/")[-1]
            if ref_name in defs:
                return _inline_refs(defs[ref_name].copy(), defs)
        return {k: _inline_refs(v, defs) for k, v in schema.items()}
    if isinstance(schema, list):
        return [_inline_refs(item, defs) for item in schema]
    return schema


def _parse_docstring_params(docstring: str) -> dict[str, str]:
    """Parse parameter descriptions from Google-style docstrings."""
    params: dict[str, str] = {}

    args_match = re.search(r"Args:\s*\n((?:\s+.+\n?)+)", docstring, re.IGNORECASE)
    if not args_match:
        return params

    param_pattern = re.compile(
        r"^\s+(\w+)(?:\s*\([^)]*\))?\s*:\s*(.+?)(?=\n\s+\w+|\n\s*$|\Z)",
        re.MULTILINE | re.DOTALL,
    )

    for match in param_pattern.finditer(args_match.group(1)):
        params[match.group(1)] = re.sub(r"\s+", " ", match.group(2).strip())

    return params
