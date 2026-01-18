"""
Artifact creation tools for displaying rich content in the artifact panel.

These tools allow the AI to create markdown documents and interactive HTML
content that renders in a dedicated panel.
"""

from agno_toolset import tool


@tool(
    name="Write Artifact",
    description="Create a markdown artifact for displaying formatted text, documentation, or structured content",
)
def write_artifact(title: str, content: str) -> str:
    """
    Create a markdown artifact that renders in the artifact panel.

    Args:
        title: Display title for the artifact
        content: Markdown content to render

    Returns:
        The markdown content (passed to renderer)
    """
    return content


@tool(
    name="Write HTML Artifact",
    description="Create an interactive HTML artifact for visualizations, diagrams, or custom interfaces",
)
def write_html_artifact(title: str, html: str) -> str:
    """
    Create an HTML artifact that renders in a sandboxed iframe.

    Args:
        title: Display title for the artifact
        html: HTML content to render (can be a full document or fragment)

    Returns:
        The HTML content (passed to renderer)
    """
    return html
