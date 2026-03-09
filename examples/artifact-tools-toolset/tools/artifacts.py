"""
Artifact creation tools for displaying rich content in the artifact panel.

These tools allow the AI to create markdown documents and interactive HTML
content that renders in a dedicated panel.
"""

from __future__ import annotations

from pathlib import Path

from covalt_toolset import get_context, tool


def _resolve_workspace_path(workspace: Path, relative_path: str) -> tuple[Path, str]:
    clean_relative_path = relative_path.strip().lstrip("/")
    if not clean_relative_path:
        raise ValueError("Path is required")

    target = (workspace / clean_relative_path).resolve()
    workspace_root = workspace.resolve()

    try:
        normalized_relative_path = str(target.relative_to(workspace_root))
    except ValueError as exc:
        raise ValueError("Path must stay within the workspace") from exc

    return target, normalized_relative_path


@tool(
    name="Write Artifact",
    description="Create a markdown artifact for displaying formatted text, documentation, or structured content",
)
def write_artifact(path: str, content: str) -> dict[str, str | int]:
    """
    Create a markdown artifact file in the workspace and render it in the artifact panel.

    Args:
        path: File path relative to workspace (for example "artifacts/notes/todo.md")
        content: Markdown content to render

    Returns:
        Metadata about the written markdown artifact file
    """
    ctx = get_context()
    target, relative_path = _resolve_workspace_path(ctx.workspace, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

    return {
        "path": relative_path,
        "size": len(content),
    }


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
