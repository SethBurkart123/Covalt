"""Tests for Wave 4 D3 droid renderer-mapping helpers."""

from __future__ import annotations

import re

import pytest

from backend.runtime import ApprovalEditable
from nodes._droid_renderer_config import (
    DROID_CONFIRMATION_RENDERER_MAP,
    droid_confirmation_to_renderer,
    droid_editable_for_kind,
    droid_risk_level,
    make_droid_approval_config,
)
from nodes._renderers import resolve_default_renderer
from nodes.core.droid_agent.executor import DroidAgentExecutor


def test_default_renderers_resolves_execute_to_terminal() -> None:
    assert (
        resolve_default_renderer(DroidAgentExecutor.default_renderers, "execute")
        == "terminal"
    )


def test_default_renderers_resolves_edit_create_to_file_diff() -> None:
    mapping = DroidAgentExecutor.default_renderers
    assert resolve_default_renderer(mapping, "edit") == "file-diff"
    assert resolve_default_renderer(mapping, "create") == "file-diff"


def test_default_renderers_resolves_apply_patch_with_optional_separator() -> None:
    mapping = DroidAgentExecutor.default_renderers
    assert resolve_default_renderer(mapping, "apply_patch") == "patch-diff"
    assert resolve_default_renderer(mapping, "applypatch") == "patch-diff"


def test_default_renderers_returns_none_for_unknown_tool() -> None:
    mapping = DroidAgentExecutor.default_renderers
    assert resolve_default_renderer(mapping, "totally-unknown-tool") is None


def test_default_renderers_is_case_insensitive_for_string_keys() -> None:
    mapping = {"my_tool": "code"}
    assert resolve_default_renderer(mapping, "MY_TOOL") == "code"


def test_default_renderers_supports_compiled_pattern_keys() -> None:
    mapping = {re.compile(r"^prefix_.*$"): "frame"}
    assert resolve_default_renderer(mapping, "prefix_anything") == "frame"
    assert resolve_default_renderer(mapping, "no_match") is None


def test_default_renderers_returns_none_for_empty_inputs() -> None:
    assert resolve_default_renderer(None, "execute") is None
    assert resolve_default_renderer({}, "execute") is None
    assert resolve_default_renderer({"x": "y"}, None) is None


def test_droid_confirmation_to_renderer_map_keys() -> None:
    assert droid_confirmation_to_renderer("exec") == "terminal"
    assert droid_confirmation_to_renderer("edit") == "file-diff"
    assert droid_confirmation_to_renderer("create") == "file-diff"
    assert droid_confirmation_to_renderer("apply_patch") == "patch-diff"
    assert droid_confirmation_to_renderer("mcp_tool") == "default"


def test_droid_confirmation_to_renderer_returns_none_for_unknown() -> None:
    assert droid_confirmation_to_renderer(None) is None
    assert droid_confirmation_to_renderer("") is None
    assert droid_confirmation_to_renderer("totally-unknown") is None


def test_droid_confirmation_renderer_map_is_complete() -> None:
    assert set(DROID_CONFIRMATION_RENDERER_MAP.keys()) == {
        "exec",
        "edit",
        "create",
        "apply_patch",
        "mcp_tool",
    }


def test_droid_editable_for_kind_exec() -> None:
    edits = droid_editable_for_kind("exec", {})
    assert edits == [
        ApprovalEditable(
            path=["command"], schema={"type": "string"}, label="Command"
        )
    ]


def test_droid_editable_for_kind_edit_and_create() -> None:
    for kind in ("edit", "create"):
        edits = droid_editable_for_kind(kind, {})
        assert edits == [
            ApprovalEditable(
                path=["new_str"], schema={"type": "string"}, label="New content"
            )
        ]


def test_droid_editable_for_kind_apply_patch() -> None:
    edits = droid_editable_for_kind("apply_patch", {})
    assert edits == [
        ApprovalEditable(path=["patch"], schema={"type": "string"}, label="Patch")
    ]


def test_droid_editable_for_kind_unknown_returns_empty() -> None:
    assert droid_editable_for_kind(None, {}) == []
    assert droid_editable_for_kind("mcp_tool", {}) == []


@pytest.mark.parametrize(
    "impact, expected",
    [
        ("high", "high"),
        ("critical", "high"),
        ("destructive", "high"),
        ("medium", "medium"),
        ("moderate", "medium"),
        ("low", "low"),
        ("safe", "low"),
        ("HIGH", "high"),
        ("Mystery", "unknown"),
    ],
)
def test_droid_risk_level(impact: str, expected: str) -> None:
    assert droid_risk_level(impact) == expected


def test_droid_risk_level_none_or_empty() -> None:
    assert droid_risk_level(None) is None
    assert droid_risk_level("") is None


def test_make_droid_approval_config_exec() -> None:
    config = make_droid_approval_config(
        "exec",
        details={"command": "ls -la", "cwd": "/tmp"},
        tool_args={"command": "ls -la"},
    )
    assert config["confirmation_type"] == "exec"
    assert config["command"] == "ls -la"
    assert config["cwd"] == "/tmp"
    assert config["tool_args"]["command"] == "ls -la"
    assert config["tool_args"]["cwd"] == "/tmp"


def test_make_droid_approval_config_edit_pulls_file_fields() -> None:
    config = make_droid_approval_config(
        "edit",
        details={"filePath": "/x.txt", "oldStr": "a", "newStr": "b"},
        tool_args=None,
    )
    assert config["filePath"] == "/x.txt"
    assert config["oldStr"] == "a"
    assert config["newStr"] == "b"


def test_make_droid_approval_config_apply_patch() -> None:
    config = make_droid_approval_config(
        "apply_patch",
        details={"patch": "diff --git a/x b/x"},
        tool_args={},
    )
    assert config["patch"] == "diff --git a/x b/x"
    assert config["tool_args"]["patch"] == "diff --git a/x b/x"


def test_make_droid_approval_config_mcp_tool_includes_passthrough() -> None:
    config = make_droid_approval_config(
        "mcp_tool",
        details={"server": "fs"},
        tool_args={"path": "/tmp"},
    )
    assert config["confirmation_type"] == "mcp_tool"
    assert config["tool_args"] == {"path": "/tmp"}
    assert config["details"] == {"server": "fs"}


def test_smoke_resolver_returns_terminal_for_droid_execute() -> None:
    """End-to-end: droid `execute` tool resolves to the `terminal` renderer."""
    assert (
        resolve_default_renderer(
            DroidAgentExecutor.default_renderers, "execute"
        )
        == "terminal"
    )
