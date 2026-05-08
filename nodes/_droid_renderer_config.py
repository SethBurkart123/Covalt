"""Shared helpers mapping droid `confirmationType` payloads to renderer hints.

Used by the droid executor (and any approval-bridge code) to translate the
droid SDK's `confirmation_type` enum into:

  * a frontend renderer key (`terminal`, `file-diff`, `patch-diff`, ...).
  * the editable-arg paths each renderer expects.
  * a normalized risk-level string.
  * a renderer-friendly `config` dict that frontend approval components can
    read either via `request.config.toolArgs.<field>` or `request.config.<field>`.
"""

from __future__ import annotations

from typing import Any

from backend.runtime import ApprovalEditable

DROID_CONFIRMATION_RENDERER_MAP: dict[str, str] = {
    "exec": "terminal",
    "edit": "file-diff",
    "create": "file-diff",
    "apply_patch": "patch-diff",
    "mcp_tool": "default",
}


def droid_confirmation_to_renderer(confirmation_type: str | None) -> str | None:
    if not confirmation_type:
        return None
    return DROID_CONFIRMATION_RENDERER_MAP.get(confirmation_type)


def droid_editable_for_kind(
    confirmation_type: str | None,
    details: dict[str, Any] | None = None,
) -> list[ApprovalEditable]:
    del details
    if confirmation_type == "exec":
        return [
            ApprovalEditable(
                path=["command"], schema={"type": "string"}, label="Command"
            )
        ]
    if confirmation_type in ("edit", "create"):
        return [
            ApprovalEditable(
                path=["new_str"], schema={"type": "string"}, label="New content"
            )
        ]
    if confirmation_type == "apply_patch":
        return [
            ApprovalEditable(
                path=["patch"], schema={"type": "string"}, label="Patch"
            )
        ]
    return []


def droid_risk_level(impact_level: str | None) -> str | None:
    if not impact_level:
        return None
    impact_lower = impact_level.lower()
    if impact_lower in ("high", "critical", "destructive"):
        return "high"
    if impact_lower in ("medium", "moderate"):
        return "medium"
    if impact_lower in ("low", "safe"):
        return "low"
    return "unknown"


def make_droid_approval_config(
    confirmation_type: str | None,
    details: dict[str, Any] | None,
    tool_args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_details = dict(details or {})
    safe_args = dict(tool_args or {})
    config: dict[str, Any] = {
        "confirmation_type": confirmation_type,
        "tool_args": safe_args,
        "details": safe_details,
    }

    if confirmation_type == "exec":
        command = safe_args.get("command") or safe_details.get("command")
        cwd = safe_args.get("cwd") or safe_details.get("cwd")
        if command is not None:
            config["command"] = command
            config["tool_args"].setdefault("command", command)
        if cwd is not None:
            config["cwd"] = cwd
            config["tool_args"].setdefault("cwd", cwd)
    elif confirmation_type in ("edit", "create"):
        for key in ("filePath", "file_path", "oldStr", "old_str", "newStr", "new_str"):
            value = safe_args.get(key)
            if value is None:
                value = safe_details.get(key)
            if value is not None:
                config[key] = value
    elif confirmation_type == "apply_patch":
        patch = safe_args.get("patch") or safe_details.get("patch")
        if patch is not None:
            config["patch"] = patch
            config["tool_args"].setdefault("patch", patch)

    return config
