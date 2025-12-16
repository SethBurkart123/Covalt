"""
Built-in tools for the agent.

Tools defined here are automatically registered with the ToolRegistry
when this module is imported.
"""

import time

from backend.services.tool_registry import tool


@tool(
    name="Calculator",
    description="Perform basic mathematical calculations",
    category="utility",
)
def calculate(expression: str) -> str:
    """
    Evaluate a mathematical expression.

    Args:
        expression: Math expression to evaluate (e.g., "2 + 2", "10 * 5")

    Returns:
        Result of the calculation
    """
    time.sleep(1)

    try:
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


@tool(
    name="Echo",
    description="Echo back the input (for testing)",
    category="utility",
)
def echo(message: str) -> str:
    """
    Echo back the input message.

    Args:
        message: Message to echo back

    Returns:
        The same message
    """
    time.sleep(1)

    return f"Echo: {message}"


@tool(
    name="Write Artifact",
    description="Create a markdown artifact (requires approval)",
    category="content",
    renderer="markdown",
    editable_args=["content"],
    requires_confirmation=True,
)
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
    time.sleep(0.5)

    artifact = f"# {title}\n\n{content}"
    return artifact
