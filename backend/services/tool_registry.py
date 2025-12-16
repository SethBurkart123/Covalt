"""
Tool Registry for managing available tools.

Provides centralized registry for tools that can be dynamically
activated/deactivated for agents at runtime.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional


class ToolRegistry:
    """
    Centralized registry for managing available tools.

    Tools are registered as factory functions that return tool instances
    or decorated functions. This allows lazy instantiation and configuration.
    """

    def __init__(self) -> None:
        self._tools: Dict[str, Callable[[], Any]] = {}
        self._metadata: Dict[str, Dict[str, Any]] = {}
        self._register_default_tools()

    def _register_default_tools(self) -> None:
        """Register built-in tools."""
        # Register basic calculator tool
        self.register_tool(
            tool_id="calculator",
            tool_factory=self._create_calculator_tool,
            metadata={
                "name": "Calculator",
                "description": "Perform basic mathematical calculations",
                "category": "utility",
            },
        )

        # Register echo tool for testing
        self.register_tool(
            tool_id="echo",
            tool_factory=self._create_echo_tool,
            metadata={
                "name": "Echo",
                "description": "Echo back the input (for testing)",
                "category": "utility",
            },
        )

        self.register_tool(
            tool_id="write_artifact",
            tool_factory=self._create_write_artifact_tool,
            metadata={
                "name": "Write Artifact",
                "description": "Create a markdown artifact (requires approval)",
                "category": "content",
                "renderer": "markdown",
                "editableArgs": ["content"],
            },
        )

        # Web search will be registered if duckduckgo is available
        try:
            from agno.tools.duckduckgo import DuckDuckGoTools

            self.register_tool(
                tool_id="web_search",
                tool_factory=lambda: DuckDuckGoTools(),
                metadata={
                    "name": "Web Search",
                    "description": "Search the web using DuckDuckGo",
                    "category": "search",
                },
            )
        except ImportError:
            pass

    def register_tool(
        self,
        tool_id: str,
        tool_factory: Callable[[], Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Register a tool with the registry.

        Args:
            tool_id: Unique identifier for the tool
            tool_factory: Callable that returns tool instance
            metadata: Optional metadata about the tool (name, description, etc.)
        """
        self._tools[tool_id] = tool_factory
        self._metadata[tool_id] = metadata or {}

    def get_tools(self, tool_ids: List[str]) -> List[Any]:
        """
        Get tool instances for given IDs.

        Args:
            tool_ids: List of tool identifiers

        Returns:
            List of instantiated tool objects
        """
        tools = []
        for tid in tool_ids:
            if tid in self._tools:
                try:
                    tool_instance = self._tools[tid]()
                    tools.append(tool_instance)
                except Exception as e:
                    print(f"[ToolRegistry] Failed to instantiate tool '{tid}': {e}")
        return tools

    def list_available_tools(self) -> List[Dict[str, Any]]:
        """
        Return all available tools with their metadata.

        Returns:
            List of dicts with tool_id and metadata
        """
        return [
            {
                "id": tool_id,
                **self._metadata.get(tool_id, {}),
            }
            for tool_id in self._tools.keys()
        ]

    def has_tool(self, tool_id: str) -> bool:
        """Check if a tool is registered."""
        return tool_id in self._tools

    def get_editable_args(self, tool_id: str) -> list[str] | bool | None:
        """Get editableArgs config for a tool. Returns list of arg names, True for all, or None."""
        metadata = self._metadata.get(tool_id, {})
        return metadata.get("editableArgs")

    # Built-in tool factory methods

    @staticmethod
    def _create_calculator_tool() -> Any:
        """Create a simple calculator tool."""
        from agno.tools import tool

        @tool
        def calculate(expression: str) -> str:
            """
            Evaluate a mathematical expression.

            Args:
                expression: Math expression to evaluate (e.g., "2 + 2", "10 * 5")

            Returns:
                Result of the calculation
            """

            import time

            time.sleep(1)

            try:
                # Safe eval using only basic operations
                # Remove dangerous builtins
                allowed_names = {
                    "abs": abs,
                    "round": round,
                    "min": min,
                    "max": max,
                    "sum": sum,
                    "pow": pow,
                }
                result = eval(expression, {"__builtins__": {}}, allowed_names)
                return f"Result: {result}"
            except Exception as e:
                return f"Error: {str(e)}"

        return calculate

    @staticmethod
    def _create_echo_tool() -> Any:
        """Create a simple echo tool for testing."""
        from agno.tools import tool

        @tool
        def echo(message: str) -> str:
            """
            Echo back the input message.

            Args:
                message: Message to echo back

            Returns:
                The same message
            """

            # Delay 10 seconds
            import time

            time.sleep(1)

            return f"Echo: {message}"

        return echo

    @staticmethod
    def _create_write_artifact_tool() -> Any:
        """Create a write_artifact tool that requires approval and uses markdown rendering."""
        from agno.tools import tool

        @tool(requires_confirmation=True)
        def write_artifact(title: str, content: str) -> str:
            """
            Create a markdown artifact with the given title and content.
            This tool requires user approval before execution.

            Args:
                title: Title of the artifact
                content: Markdown content of the artifact

            Returns:
                The formatted markdown artifact
            """
            import time

            time.sleep(0.5)

            # Return formatted markdown
            artifact = f"# {title}\n\n{content}"
            return artifact

        return write_artifact


# Global singleton instance
_tool_registry: Optional[ToolRegistry] = None


def get_tool_registry() -> ToolRegistry:
    """Get the global tool registry instance (singleton)."""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
    return _tool_registry
