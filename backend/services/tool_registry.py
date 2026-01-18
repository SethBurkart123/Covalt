from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Callable

from agno.tools import tool as agno_tool

if TYPE_CHECKING:
    from .mcp_manager import MCPManager
    from .toolset_executor import ToolsetExecutor

logger = logging.getLogger(__name__)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Callable] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def register(self, name: str, fn: Any, metadata: dict[str, Any]) -> None:
        self._tools[name] = fn
        self._metadata[name] = metadata

    def get_tools(self, tool_ids: list[str]) -> list[Any]:
        tools = []
        for tid in tool_ids:
            if tid in self._tools:
                tools.append(self._tools[tid])
        return tools

    def has_tool(self, tool_id: str) -> bool:
        return tool_id in self._tools

    def _get_mcp_tool_info(self, tool_id: str) -> dict[str, Any] | None:
        if tool_id.startswith("mcp:"):
            parsed = self._parse_tool_id(tool_id)
            if parsed[0] == "mcp_tool":
                _, server_id, tool_name = parsed
                if server_id and tool_name:
                    mcp = get_mcp_manager()
                    return next(
                        (
                            t
                            for t in mcp.get_server_tools(server_id)
                            if t["name"] == tool_name
                        ),
                        None,
                    )

        return None

    def get_editable_args(self, tool_id: str) -> list[str] | None:
        metadata = self._metadata.get(tool_id, {})
        if "editable_args" in metadata:
            return metadata.get("editable_args")

        mcp_tool_info = self._get_mcp_tool_info(tool_id)
        if mcp_tool_info:
            return mcp_tool_info.get("editable_args")

        return None

    def get_renderer(self, tool_id: str) -> str | None:
        metadata = self._metadata.get(tool_id, {})
        if "renderer" in metadata:
            return metadata.get("renderer")

        mcp_tool_info = self._get_mcp_tool_info(tool_id)
        if mcp_tool_info:
            return mcp_tool_info.get("renderer")

        return None

    def _parse_tool_id(self, tool_id: str) -> tuple[str, str | None, str | None]:
        if tool_id.startswith("-"):
            inner = tool_id[1:]
            if inner.startswith("mcp:"):
                parts = inner.split(":", 2)
                if len(parts) == 3:
                    return ("blacklist", parts[1], parts[2])
            return ("blacklist", None, inner)

        if tool_id.startswith("mcp:"):
            parts = tool_id.split(":", 2)
            if len(parts) == 2:
                return ("mcp_toolset", parts[1], None)
            elif len(parts) == 3:
                return ("mcp_tool", parts[1], parts[2])

        if ":" in tool_id:
            parts = tool_id.split(":", 1)
            return ("toolset_tool", parts[0], parts[1])

        return ("builtin", None, tool_id)

    def resolve_tool_ids(
        self, tool_ids: list[str], chat_id: str | None = None
    ) -> list[Any]:
        mcp = get_mcp_manager()

        include_builtin: set[str] = set()
        include_mcp_toolsets: set[str] = set()
        include_mcp_tools: set[tuple[str, str]] = set()  # (server_id, tool_name)
        include_toolset_tools: set[str] = set()
        blacklist: set[tuple[str, str]] = set()

        for tool_id in tool_ids:
            parsed = self._parse_tool_id(tool_id)
            tool_type, namespace, tool_name = parsed

            if tool_type == "builtin" and tool_name:
                include_builtin.add(tool_name)
            elif tool_type == "mcp_toolset" and namespace:
                include_mcp_toolsets.add(namespace)
            elif tool_type == "mcp_tool" and namespace and tool_name:
                include_mcp_tools.add((namespace, tool_name))
            elif tool_type == "toolset_tool" and namespace and tool_name:
                include_toolset_tools.add(tool_id)
            elif tool_type == "blacklist" and namespace and tool_name:
                blacklist.add((namespace, tool_name))

        result: list[Any] = []

        for tool_name in include_builtin:
            if tool_name in self._tools:
                result.append(self._tools[tool_name])

        for server_id in include_mcp_toolsets:
            server_tools = mcp.get_server_tools(server_id)
            for tool_info in server_tools:
                mcp_tool_name = tool_info["name"]
                if (server_id, mcp_tool_name) not in blacklist:
                    fn = mcp.create_tool_function(server_id, mcp_tool_name)
                    if fn:
                        result.append(fn)

        added_mcp = {
            (sid, tool_info["name"])
            for sid in include_mcp_toolsets
            for tool_info in mcp.get_server_tools(sid)
        }
        for server_id, tool_name in include_mcp_tools:
            if (server_id, tool_name) not in added_mcp:
                if (server_id, tool_name) not in blacklist:
                    fn = mcp.create_tool_function(server_id, tool_name)
                    if fn:
                        result.append(fn)

        if include_toolset_tools and chat_id:
            executor = get_toolset_executor()
            for tool_id in include_toolset_tools:
                fn = executor.get_tool_function(tool_id, chat_id)
                if fn:
                    result.append(fn)
        elif include_toolset_tools and not chat_id:
            logger.warning(
                f"Toolset tools requested but no chat_id provided: {include_toolset_tools}"
            )

        return result

    def list_builtin_tools(self) -> list[dict[str, Any]]:
        return [
            {"id": tool_id, **self._metadata.get(tool_id, {})}
            for tool_id in self._tools.keys()
        ]

    def list_toolset_tools(self) -> list[dict[str, Any]]:
        executor = get_toolset_executor()
        return executor.list_toolset_tools()


_tool_registry: ToolRegistry | None = None


def get_mcp_manager() -> "MCPManager":
    from .mcp_manager import get_mcp_manager as _get_mcp_manager

    return _get_mcp_manager()


def get_toolset_executor() -> "ToolsetExecutor":
    from .toolset_executor import get_toolset_executor as _get_toolset_executor

    return _get_toolset_executor()


def get_tool_registry() -> ToolRegistry:
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
    return _tool_registry


def tool(
    name: str | None = None,
    description: str | None = None,
    renderer: str | None = None,
    editable_args: list[str] | None = None,
    requires_confirmation: bool = False,
    stop_after_tool_call: bool = False,
    cache_results: bool = False,
    cache_dir: str | None = None,
    cache_ttl: int | None = None,
    tool_hooks: list[Callable] | None = None,
    pre_hook: Callable | None = None,
    post_hook: Callable | None = None,
    requires_user_input: bool = False,
    user_input_fields: list[str] | None = None,
    external_execution: bool = False,
) -> Callable[[Callable], Any]:
    def decorator(fn: Callable) -> Any:
        agno_kwargs: dict[str, Any] = {}
        if requires_confirmation:
            agno_kwargs["requires_confirmation"] = requires_confirmation
        if stop_after_tool_call:
            agno_kwargs["stop_after_tool_call"] = stop_after_tool_call
        if cache_results:
            agno_kwargs["cache_results"] = cache_results
        if cache_dir is not None:
            agno_kwargs["cache_dir"] = cache_dir
        if cache_ttl is not None:
            agno_kwargs["cache_ttl"] = cache_ttl
        if tool_hooks is not None:
            agno_kwargs["tool_hooks"] = tool_hooks
        if pre_hook is not None:
            agno_kwargs["pre_hook"] = pre_hook
        if post_hook is not None:
            agno_kwargs["post_hook"] = post_hook
        if requires_user_input:
            agno_kwargs["requires_user_input"] = requires_user_input
        if user_input_fields is not None:
            agno_kwargs["user_input_fields"] = user_input_fields
        if external_execution:
            agno_kwargs["external_execution"] = external_execution

        if agno_kwargs:
            wrapped = agno_tool(**agno_kwargs)(fn)
        else:
            wrapped = agno_tool(fn)

        tool_description = description
        if tool_description is None and fn.__doc__:
            tool_description = fn.__doc__.strip().split("\n")[0]

        display_name = name if name else fn.__name__.replace("_", " ").title()

        metadata: dict[str, Any] = {
            "name": display_name,
            "description": tool_description or "",
        }
        if renderer is not None:
            metadata["renderer"] = renderer
        if editable_args is not None:
            metadata["editable_args"] = editable_args

        global _tool_registry
        if _tool_registry is None:
            _tool_registry = ToolRegistry()
        _tool_registry.register(fn.__name__, wrapped, metadata)

        return wrapped

    return decorator
