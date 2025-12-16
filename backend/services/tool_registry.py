"""
Tool Registry for managing available tools.

Provides a unified @tool decorator that wraps agno's @tool while also
registering tools with a centralized registry for UI display and activation.
"""

from __future__ import annotations

from typing import Any, Callable

from agno.tools import tool as agno_tool


class ToolRegistry:
    """
    Centralized registry for managing available tools.

    Tools are registered automatically when decorated with @tool.
    The registry stores both the wrapped tool function and UI metadata.
    """

    def __init__(self) -> None:
        self._tools: dict[str, Callable] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def register(self, name: str, fn: Any, metadata: dict[str, Any]) -> None:
        """
        Register a tool with the registry.

        Called internally by the @tool decorator.
        """
        self._tools[name] = fn
        self._metadata[name] = metadata

    def get_tools(self, tool_ids: list[str]) -> list[Any]:
        """
        Get tool instances for given IDs.

        Returns the wrapped tool functions ready to pass to an agno Agent.
        """
        tools = []
        for tid in tool_ids:
            if tid in self._tools:
                tools.append(self._tools[tid])
        return tools

    def list_available_tools(self) -> list[dict[str, Any]]:
        """
        Return all available tools with their metadata for UI display.
        """
        return [
            {"id": tool_id, **self._metadata.get(tool_id, {})}
            for tool_id in self._tools.keys()
        ]

    def has_tool(self, tool_id: str) -> bool:
        """Check if a tool is registered."""
        return tool_id in self._tools

    def get_editable_args(self, tool_id: str) -> list[str] | None:
        """Get editable_args config for a tool."""
        metadata = self._metadata.get(tool_id, {})
        return metadata.get("editable_args")


_tool_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Get the global tool registry instance (singleton)."""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
        import backend.services.builtin_tools  # noqa: F401
    return _tool_registry


def tool(
    name: str | None = None,
    description: str | None = None,
    category: str = "utility",
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
    """
    Unified tool decorator that wraps agno's @tool and registers with the ToolRegistry.

    UI/Registry metadata:
        name: Display name in UI (defaults to function name titlecased)
        description: Display description in UI (defaults to docstring first line)
        category: Tool category for UI grouping
        renderer: UI renderer type (e.g., "markdown")
        editable_args: Args editable in UI before execution

    Agno @tool passthrough options:
        requires_confirmation: Requires user confirmation before execution
        stop_after_tool_call: Stop the agent run after the tool call
        cache_results: Cache the tool result
        cache_dir: Directory to store cache files
        cache_ttl: Time-to-live for cached results in seconds
        tool_hooks: List of hooks that wrap the function execution
        pre_hook: Hook to run before the function is executed
        post_hook: Hook to run after the function is executed
        requires_user_input: Requires user input before execution
        user_input_fields: List of fields that require user input
        external_execution: Tool will be executed outside of the agent's control
    """

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
            "category": category,
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
