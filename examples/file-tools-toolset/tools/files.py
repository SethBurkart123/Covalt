"""
File manipulation tools for the workspace.

Each tool receives a `workspace` Path argument pointing to the chat's
materialized workspace directory.
"""

from pathlib import Path


def write_file(workspace: Path, path: str, content: str) -> dict:
    """
    Write content to a file in the workspace.

    Args:
        workspace: Path to the chat's workspace directory
        path: Relative file path
        content: Content to write

    Returns:
        Dict with written path and size
    """
    target = workspace / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)

    return {
        "path": path,
        "size": len(content),
        "message": f"Successfully wrote {len(content)} characters to {path}",
    }


def read_file(workspace: Path, path: str) -> dict:
    """
    Read content from a file in the workspace.

    Args:
        workspace: Path to the chat's workspace directory
        path: Relative file path

    Returns:
        Dict with path, content, and size
    """
    target = workspace / path

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


def list_files(workspace: Path, directory: str = "") -> dict:
    """
    List files in the workspace or a subdirectory.

    Args:
        workspace: Path to the chat's workspace directory
        directory: Subdirectory to list (empty for root)

    Returns:
        Dict with list of files
    """
    target = workspace / directory if directory else workspace

    if not target.exists():
        return {
            "error": f"Directory not found: {directory or '/'}",
            "files": [],
        }

    files = []
    dirs = []

    for item in sorted(target.iterdir()):
        rel_path = str(item.relative_to(workspace))
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


def delete_file(workspace: Path, path: str) -> dict:
    """
    Delete a file from the workspace.

    Args:
        workspace: Path to the chat's workspace directory
        path: Relative file path to delete

    Returns:
        Dict with deletion status
    """
    target = workspace / path

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
