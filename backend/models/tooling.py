from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


RENDERER_ALIAS_MAP: dict[str, str] = {
    "markdown": "document",
}

SUPPORTED_RENDERERS: set[str] = {
    "default",
    "code",
    "document",
    "html",
    "frame",
}

RendererConfigType = Literal["string", "bool", "port", "any"]

RENDERER_CONFIG_SCHEMAS: dict[str, dict[str, RendererConfigType]] = {
    "default": {},
    "code": {
        "file": "string",
        "content": "string",
        "language": "string",
        "editable": "bool",
    },
    "document": {
        "file": "string",
        "content": "string",
        "editable": "bool",
    },
    "html": {
        "content": "string",
        "artifact": "string",
        "data": "any",
    },
    "frame": {
        "url": "string",
        "port": "port",
    },
}


def normalize_renderer_alias(renderer: str | None) -> str | None:
    if not renderer:
        return renderer
    return RENDERER_ALIAS_MAP.get(renderer, renderer)


def validate_renderer_manifest_entry(
    renderer: Any,
    *,
    context: str,
) -> tuple[str, dict[str, Any]]:
    if not isinstance(renderer, dict):
        raise ValueError(f"{context} must be an object")

    renderer_type = renderer.get("type")
    if not isinstance(renderer_type, str) or not renderer_type.strip():
        raise ValueError(f"{context} is missing required field: type")

    config = {k: v for k, v in renderer.items() if k != "type"}
    normalized_renderer, normalized_config = validate_renderer_override(
        renderer=renderer_type,
        renderer_config=config,
        context=context,
    )
    if not normalized_renderer:
        raise ValueError(f"{context} is missing required field: type")

    return normalized_renderer, normalized_config


def validate_renderer_override(
    renderer: str | None,
    renderer_config: Any,
    *,
    context: str,
) -> tuple[str | None, dict[str, Any]]:
    if renderer is None:
        if renderer_config is None:
            return None, {}
        raise ValueError(f"{context} renderer_config requires renderer")

    if not isinstance(renderer, str) or not renderer.strip():
        raise ValueError(f"{context} renderer must be a non-empty string")

    normalized_renderer = normalize_renderer_alias(renderer.strip())
    if normalized_renderer not in SUPPORTED_RENDERERS:
        allowed = ", ".join(sorted(SUPPORTED_RENDERERS))
        raise ValueError(
            f"{context} renderer '{renderer}' is unsupported (allowed: {allowed})"
        )

    config = _coerce_renderer_config(renderer_config, context=context)
    _validate_renderer_config_shape(
        normalized_renderer,
        config,
        context=context,
    )

    return normalized_renderer, config


def _coerce_renderer_config(
    renderer_config: Any,
    *,
    context: str,
) -> dict[str, Any]:
    if renderer_config is None:
        return {}
    if not isinstance(renderer_config, dict):
        raise ValueError(f"{context} renderer_config must be an object")
    return renderer_config


def _validate_renderer_config_shape(
    renderer: str,
    config: dict[str, Any],
    *,
    context: str,
) -> None:
    schema = RENDERER_CONFIG_SCHEMAS.get(renderer, {})

    unknown_keys = sorted(set(config) - set(schema))
    if unknown_keys:
        suffix = ", ".join(unknown_keys)
        raise ValueError(
            f"{context} renderer_config has unknown key(s) for renderer '{renderer}': {suffix}"
        )

    for key, expected_type in schema.items():
        value = config.get(key)
        if value is None or expected_type == "any":
            continue
        if expected_type == "string":
            _validate_string(value, key=key, context=context)
            continue
        if expected_type == "bool":
            _validate_bool(value, key=key, context=context)
            continue
        if expected_type == "port":
            _validate_port(value, key=key, context=context)


def _validate_string(
    value: Any,
    *,
    key: str,
    context: str,
) -> None:
    if not isinstance(value, str):
        raise ValueError(f"{context} renderer_config.{key} must be a string")


def _validate_bool(
    value: Any,
    *,
    key: str,
    context: str,
) -> None:
    if not isinstance(value, bool):
        raise ValueError(f"{context} renderer_config.{key} must be a boolean")


def _validate_port(
    value: Any,
    *,
    key: str,
    context: str,
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{context} renderer_config.{key} must be a number or string")


@dataclass(frozen=True)
class ParsedToolId:
    kind: str
    namespace: str | None
    name: str | None


def is_mcp_tool_id(tool_id: str) -> bool:
    return tool_id.startswith("mcp:")


def parse_tool_id(tool_id: str) -> ParsedToolId:
    if tool_id.startswith("-"):
        inner = tool_id[1:]
        if inner.startswith("mcp:"):
            parts = inner.split(":", 2)
            if len(parts) == 3:
                return ParsedToolId("blacklist", parts[1], parts[2])
        return ParsedToolId("blacklist", None, inner)

    if tool_id.startswith("mcp:"):
        parts = tool_id.split(":", 2)
        if len(parts) == 2:
            return ParsedToolId("mcp_toolset", parts[1], None)
        if len(parts) == 3:
            return ParsedToolId("mcp_tool", parts[1], parts[2])

    if tool_id.startswith("toolset:"):
        return ParsedToolId("toolset_all", tool_id.split(":", 1)[1], None)

    if ":" in tool_id:
        namespace, name = tool_id.split(":", 1)
        return ParsedToolId("toolset_tool", namespace, name)

    return ParsedToolId("builtin", None, tool_id)


def normalize_override_tool_id(raw_id: str, toolset_id: str) -> str:
    tool_id = raw_id.strip()
    if tool_id.startswith("mcp:"):
        tool_id = tool_id[4:]
    if ":" not in tool_id:
        return f"{toolset_id}:{tool_id}"
    return tool_id


def format_mcp_toolset_id(server_key: str) -> str:
    return f"mcp:{server_key}"


def format_mcp_tool_id(server_key: str, tool_name: str) -> str:
    return f"mcp:{server_key}:{tool_name}"


def split_mcp_tool_id(tool_id: str) -> tuple[str, str] | None:
    parsed = parse_tool_id(tool_id)
    if parsed.kind != "mcp_tool" or not parsed.namespace or not parsed.name:
        return None
    return parsed.namespace, parsed.name


def get_tool_display_label(tool_id: str, fallback_name: str | None = None) -> str:
    if fallback_name:
        return fallback_name

    parsed = parse_tool_id(tool_id)
    if parsed.kind == "mcp_tool" and parsed.name:
        return parsed.name
    if parsed.kind in {"toolset_tool", "blacklist"} and parsed.name:
        return parsed.name
    return tool_id


def parse_tool_display_parts(tool_name: str) -> tuple[str, str | None]:
    if ":" not in tool_name:
        return tool_name, None

    namespace, name = tool_name.split(":", 1)
    if "~" in namespace:
        _, namespace = namespace.split("~", 1)
    return name or tool_name, namespace or None
