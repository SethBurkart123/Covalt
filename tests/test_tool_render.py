"""Tests for `_resolve_tool_render_plan` resolver chain (Wave 4 D3)."""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any
from unittest.mock import patch

import pytest

from backend.services.renderers.registry import (
    clear_registry,
    register_builtin_renderers,
)
from backend.services.tools import tool_render
from backend.services.tools.tool_render import _resolve_tool_render_plan


@pytest.fixture(autouse=True)
def _builtin_registry() -> Iterator[None]:
    clear_registry()
    register_builtin_renderers()
    yield
    clear_registry()
    register_builtin_renderers()


class _FakeExecutor:
    default_renderers = {
        re.compile(r"^my_run_tool$", re.IGNORECASE): "frame",
    }


def _stub_no_op_node_lookup(node_type: str | None) -> Any:
    if node_type == "fake-node":
        return _FakeExecutor()
    return None


def _stub_tool_registry_get_renderer(self: Any, tool_name: str) -> str | None:
    del self, tool_name
    return None


def test_resolver_returns_provided_plan_first() -> None:
    plan = _resolve_tool_render_plan(
        tool_name="bash",
        tool_args={},
        tool_result=None,
        tool_call_id=None,
        chat_id=None,
        provided_plan={"renderer": "code", "config": {"x": 1}},
    )
    assert plan == {"renderer": "code", "config": {"x": 1}}


def test_resolver_uses_executor_default_renderers_when_no_plan() -> None:
    with patch.object(tool_render, "_get_node_executor", _stub_no_op_node_lookup):
        with patch.object(
            tool_render.registry.__class__,
            "get_renderer",
            _stub_tool_registry_get_renderer,
        ):
            plan = _resolve_tool_render_plan(
                tool_name="my_run_tool",
                tool_args={},
                tool_result=None,
                tool_call_id=None,
                chat_id=None,
                node_type="fake-node",
            )
    assert plan == {"renderer": "frame", "config": {}}


def test_resolver_falls_back_to_registry_tool_name_pattern() -> None:
    with patch.object(
        tool_render.registry.__class__,
        "get_renderer",
        _stub_tool_registry_get_renderer,
    ):
        plan = _resolve_tool_render_plan(
            tool_name="bash",
            tool_args={},
            tool_result=None,
            tool_call_id=None,
            chat_id=None,
        )
    assert plan == {"renderer": "terminal", "config": {}}


def test_resolver_returns_none_when_no_match() -> None:
    with patch.object(
        tool_render.registry.__class__,
        "get_renderer",
        _stub_tool_registry_get_renderer,
    ):
        plan = _resolve_tool_render_plan(
            tool_name="totally-unknown-tool-xyz",
            tool_args={},
            tool_result=None,
            tool_call_id=None,
            chat_id=None,
        )
    assert plan is None


def test_resolver_returns_none_on_failed() -> None:
    plan = _resolve_tool_render_plan(
        tool_name="bash",
        tool_args={},
        tool_result=None,
        tool_call_id=None,
        chat_id=None,
        failed=True,
    )
    assert plan is None


def test_resolver_executor_match_takes_precedence_over_registry() -> None:
    class FakeBashOverride:
        default_renderers = {re.compile(r"^bash$", re.IGNORECASE): "code"}

    def _lookup(node_type: str | None) -> Any:
        if node_type == "override":
            return FakeBashOverride()
        return None

    with patch.object(tool_render, "_get_node_executor", _lookup):
        with patch.object(
            tool_render.registry.__class__,
            "get_renderer",
            _stub_tool_registry_get_renderer,
        ):
            plan = _resolve_tool_render_plan(
                tool_name="bash",
                tool_args={},
                tool_result=None,
                tool_call_id=None,
                chat_id=None,
                node_type="override",
            )
    assert plan == {"renderer": "code", "config": {}}
