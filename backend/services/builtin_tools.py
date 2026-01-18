"""Built-in tools for the agent."""

from backend.services.tool_registry import tool

@tool(
    name="Write Artifact",
    description="Create a markdown artifact",
    renderer="markdown",
    editable_args=["content"],
    requires_confirmation=True,
)
def write_artifact(title: str, content: str) -> str:
    return content


@tool(
    name="Write HTML Artifact",
    description="Create an HTML artifact",
    renderer="html",
    editable_args=["html"],
    requires_confirmation=True,
)
def write_html_artifact(title: str, html: str) -> str:
    return html
