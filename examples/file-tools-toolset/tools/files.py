"""
File manipulation tools for the workspace.

Each tool uses get_context() to access the chat's workspace directory.
"""

from covalt_toolset import get_context, tool


@tool(name="Write File", description="Write content to a file in the workspace")
def write_file(path: str, content: str) -> dict:
    """
    Write content to a file in the workspace.

    Args:
        path: File path relative to workspace (e.g., "src/main.py")
        content: Content to write to the file

    Returns:
        Dict with written path and size
    """
    ctx = get_context()
    target = ctx.workspace / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)

    return {
        "path": path,
        "size": len(content),
        "message": f"Successfully wrote {len(content)} characters to {path}",
    }


@tool(name="Read File", description="Read the contents of a file from the workspace")
def read_file(path: str) -> dict:
    """
    Read content from a file in the workspace.

    Args:
        path: File path relative to workspace

    Returns:
        Dict with path, content, and size
    """
    ctx = get_context()
    target = ctx.workspace / path

    if not target.exists():
        return {
            "error": f"File not found: {path}",
            "path": path,
        }

    if not target.is_file():
        return {
            "error": f"Not a file: {path}",
            "path": path,
        }

    content = target.read_text()

    return {
        "path": path,
        "content": content,
        "size": len(content),
    }


@tool(
    name="List Files",
    description="List all files in the workspace or a specific directory",
)
def list_files(directory: str = "") -> dict:
    """
    List files in the workspace or a subdirectory.

    Args:
        directory: Subdirectory to list (empty for root)

    Returns:
        Dict with list of files
    """
    ctx = get_context()
    target = ctx.workspace / directory if directory else ctx.workspace

    if not target.exists():
        return {
            "error": f"Directory not found: {directory or '/'}",
            "files": [],
        }

    files = []
    dirs = []

    for item in sorted(target.iterdir()):
        rel_path = str(item.relative_to(ctx.workspace))
        if item.is_file():
            files.append(
                {
                    "path": rel_path,
                    "size": item.stat().st_size,
                    "type": "file",
                }
            )
        elif item.is_dir():
            dirs.append(
                {
                    "path": rel_path,
                    "type": "directory",
                }
            )

    return {
        "directory": directory or "/",
        "files": files,
        "directories": dirs,
        "total": len(files) + len(dirs),
    }


@tool(
    name="Delete File",
    description="Delete a file from the workspace",
    requires_confirmation=True,
)
def delete_file(path: str) -> dict:
    """
    Delete a file from the workspace.

    Args:
        path: File path relative to workspace to delete

    Returns:
        Dict with deletion status
    """
    ctx = get_context()
    target = ctx.workspace / path

    if not target.exists():
        return {
            "error": f"File not found: {path}",
            "deleted": False,
        }

    if not target.is_file():
        return {
            "error": f"Not a file (use rmdir for directories): {path}",
            "deleted": False,
        }

    target.unlink()

    return {
        "path": path,
        "deleted": True,
        "message": f"Successfully deleted {path}",
    }
