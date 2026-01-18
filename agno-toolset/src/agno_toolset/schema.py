"""
Type hints to JSON Schema conversion.

Converts Python type annotations (including Pydantic models) to JSON Schema
for use in LLM function calling.
"""

from __future__ import annotations

import inspect
import re
from typing import Any, Callable, Union, get_args, get_origin, get_type_hints

# Try to import Pydantic - it's optional but recommended
try:
    from pydantic import BaseModel

    HAS_PYDANTIC = True
except ImportError:
    BaseModel = None  # type: ignore
    HAS_PYDANTIC = False


def function_to_json_schema(fn: Callable) -> dict[str, Any]:
    """
    Convert a function's signature and type hints to JSON Schema.

    Extracts parameter types from type hints and descriptions from docstrings.
    Supports basic types, Optional, list, dict, and Pydantic models.

    Args:
        fn: The function to convert.

    Returns:
        JSON Schema dict with type, properties, and required fields.
    """
    try:
        hints = get_type_hints(fn, include_extras=True)
    except Exception:
        hints = {}

    sig = inspect.signature(fn)
    docstring_params = _parse_docstring_params(fn.__doc__ or "")

    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        # Skip self, cls, and return annotation
        if param_name in ("self", "cls"):
            continue

        param_type = hints.get(param_name, Any)
        prop_schema = type_to_json_schema(param_type)

        # Add description from docstring
        if param_name in docstring_params:
            prop_schema["description"] = docstring_params[param_name]

        # Handle default values
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
    """
    Convert a Python type to JSON Schema.

    Handles:
    - Basic types (str, int, float, bool)
    - None/NoneType
    - list[T], dict[K, V]
    - Optional[T], Union[T, None]
    - Pydantic BaseModel subclasses
    - Any (no type constraint)

    Args:
        t: The type to convert.

    Returns:
        JSON Schema dict.
    """
    # Handle None
    if t is None or t is type(None):
        return {"type": "null"}

    # Handle Pydantic models
    if (
        HAS_PYDANTIC
        and BaseModel is not None
        and isinstance(t, type)
        and issubclass(t, BaseModel)
    ):
        return _pydantic_to_schema(t)

    # Handle basic types
    if t is str:
        return {"type": "string"}
    if t is int:
        return {"type": "integer"}
    if t is float:
        return {"type": "number"}
    if t is bool:
        return {"type": "boolean"}
    if t is Any:
        return {}  # No type constraint

    # Handle generic types
    origin = get_origin(t)
    args = get_args(t)

    # Handle Optional[T] which is Union[T, None]
    if origin is Union:
        non_none_args = [a for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            # Optional[T] - just return T's schema
            return type_to_json_schema(non_none_args[0])
        # Union of multiple types - use anyOf
        return {"anyOf": [type_to_json_schema(a) for a in args]}

    # Handle list[T]
    if origin is list:
        if args:
            return {"type": "array", "items": type_to_json_schema(args[0])}
        return {"type": "array"}

    # Handle dict[K, V]
    if origin is dict:
        schema: dict[str, Any] = {"type": "object"}
        if len(args) >= 2:
            schema["additionalProperties"] = type_to_json_schema(args[1])
        return schema

    # Handle tuple
    if origin is tuple:
        if args:
            return {"type": "array", "items": [type_to_json_schema(a) for a in args]}
        return {"type": "array"}

    # Fallback for unknown types
    return {"type": "string"}


def _pydantic_to_schema(model: type) -> dict[str, Any]:
    """
    Convert a Pydantic model to JSON Schema.

    Uses Pydantic's built-in schema generation which handles:
    - Field descriptions
    - Constraints (min/max, regex, etc.)
    - Nested models
    - Aliases
    """
    schema = model.model_json_schema()

    # Pydantic v2 puts definitions in $defs, inline them for simpler schema
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
    """
    Parse parameter descriptions from a docstring.

    Supports Google-style docstrings:
        Args:
            param_name: Description of the parameter.
            another_param: Another description.
    """
    params: dict[str, str] = {}

    # Find Args section
    args_match = re.search(r"Args:\s*\n((?:\s+.+\n?)+)", docstring, re.IGNORECASE)
    if not args_match:
        return params

    args_section = args_match.group(1)

    # Parse each parameter line
    # Matches: "    param_name: description" or "    param_name (type): description"
    param_pattern = re.compile(
        r"^\s+(\w+)(?:\s*\([^)]*\))?\s*:\s*(.+?)(?=\n\s+\w+|\n\s*$|\Z)",
        re.MULTILINE | re.DOTALL,
    )

    for match in param_pattern.finditer(args_section):
        param_name = match.group(1)
        description = match.group(2).strip()
        # Clean up multi-line descriptions
        description = re.sub(r"\s+", " ", description)
        params[param_name] = description

    return params
