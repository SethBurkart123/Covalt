from __future__ import annotations

from dataclasses import dataclass


RENDERER_ALIAS_MAP: dict[str, str] = {
    "markdown": "document",
}


def normalize_renderer_alias(renderer: str | None) -> str | None:
    if not renderer:
        return renderer
    return RENDERER_ALIAS_MAP.get(renderer, renderer)


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
