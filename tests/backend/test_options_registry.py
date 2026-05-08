"""Tests for backend/services/variables/options_registry.py."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from unittest.mock import patch

import pytest

from backend.services.variables import options_registry
from backend.services.variables.options_registry import (
    register_options_loader,
    resolve_options_via_callback,
    resolve_options_via_link,
)


@pytest.fixture(autouse=True)
def _isolate_loaders() -> Iterator[None]:
    """Snapshot _loaders so each test starts with the production set intact."""
    saved = dict(options_registry._loaders)
    options_registry._loaders.clear()
    yield
    options_registry._loaders.clear()
    options_registry._loaders.update(saved)


class TestRegister:
    def test_register_then_get_via_callback(self) -> None:
        async def loader(_params: dict[str, Any]) -> list[dict[str, Any]]:
            return [{"value": "a", "label": "A"}]

        register_options_loader("my:loader", loader)
        assert "my:loader" in options_registry._loaders

    def test_register_empty_id_raises(self) -> None:
        with pytest.raises(ValueError, match="non-empty string"):
            register_options_loader("", lambda _: [])

    def test_register_same_callable_is_idempotent(self) -> None:
        loader = lambda _: []
        register_options_loader("dup", loader)
        register_options_loader("dup", loader)
        assert options_registry._loaders["dup"] is loader

    def test_register_different_callable_raises(self) -> None:
        register_options_loader("dup", lambda _: [])
        with pytest.raises(ValueError, match="already registered"):
            register_options_loader("dup", lambda _: [])


class TestResolveViaCallback:
    @pytest.mark.asyncio
    async def test_unknown_loader_raises_keyerror(self) -> None:
        with pytest.raises(KeyError, match="Unknown options loader"):
            await resolve_options_via_callback("missing", {})

    @pytest.mark.asyncio
    async def test_async_loader(self) -> None:
        async def loader(params: dict[str, Any]) -> list[dict[str, Any]]:
            return [{"value": params.get("v", "x"), "label": "L"}]

        register_options_loader("async:loader", loader)
        result = await resolve_options_via_callback("async:loader", {"v": "hello"})
        assert result == [{"value": "hello", "label": "L"}]

    @pytest.mark.asyncio
    async def test_sync_loader(self) -> None:
        def loader(_params: dict[str, Any]) -> list[dict[str, Any]]:
            return [{"value": 1, "label": "one"}]

        register_options_loader("sync:loader", loader)
        result = await resolve_options_via_callback("sync:loader", None)
        assert result == [{"value": 1, "label": "one"}]

    @pytest.mark.asyncio
    async def test_non_list_return_raises_typeerror(self) -> None:
        def loader(_params: dict[str, Any]) -> Any:
            return "not a list"

        register_options_loader("bad:loader", loader)
        with pytest.raises(TypeError, match="must return a list"):
            await resolve_options_via_callback("bad:loader", {})

    @pytest.mark.asyncio
    async def test_non_dict_items_dropped(self) -> None:
        def loader(_params: dict[str, Any]) -> list[Any]:
            return [
                {"value": "a", "label": "A"},
                "not-a-dict",
                None,
                {"value": "b", "label": "B"},
            ]

        register_options_loader("mixed:loader", loader)
        result = await resolve_options_via_callback("mixed:loader", {})
        assert result == [
            {"value": "a", "label": "A"},
            {"value": "b", "label": "B"},
        ]

    @pytest.mark.asyncio
    async def test_normalize_propagates_group_and_icon(self) -> None:
        def loader(_params: dict[str, Any]) -> list[dict[str, Any]]:
            return [{
                "value": "x",
                "label": "X",
                "group": "G",
                "icon": "🌟",
                "extra": "ignored-by-shape",
            }]

        register_options_loader("rich:loader", loader)
        result = await resolve_options_via_callback("rich:loader", {})
        assert result == [{
            "value": "x",
            "label": "X",
            "group": "G",
            "icon": "🌟",
        }]

    @pytest.mark.asyncio
    async def test_normalize_label_falls_back_to_value(self) -> None:
        def loader(_params: dict[str, Any]) -> list[dict[str, Any]]:
            return [{"value": "only-value"}]

        register_options_loader("label:loader", loader)
        result = await resolve_options_via_callback("label:loader", {})
        assert result == [{"value": "only-value", "label": "only-value"}]

    @pytest.mark.asyncio
    async def test_none_params_treated_as_empty(self) -> None:
        captured: dict[str, Any] = {}

        def loader(params: dict[str, Any]) -> list[dict[str, Any]]:
            captured.update(params)
            return []

        register_options_loader("params:loader", loader)
        await resolve_options_via_callback("params:loader", None)
        assert captured == {}


class TestResolveViaLink:
    @pytest.mark.asyncio
    async def test_non_dict_graph_returns_empty(self) -> None:
        result = await resolve_options_via_link(None, "node-1", "vars/x")
        assert result == []

    @pytest.mark.asyncio
    async def test_no_matching_edge_returns_empty(self) -> None:
        graph = {"nodes": [], "edges": []}
        result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == []

    @pytest.mark.asyncio
    async def test_non_link_channel_ignored(self) -> None:
        graph = {
            "nodes": [{"id": "src", "type": "x", "data": {}}],
            "edges": [{
                "source": "src",
                "target": "chat-start",
                "targetHandle": "vars/topic",
                "sourceHandle": "output",
                "data": {"channel": "flow"},
            }],
        }
        result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == []

    @pytest.mark.asyncio
    async def test_materialize_list_of_options(self) -> None:
        graph = {
            "nodes": [{"id": "src", "type": "options-source", "data": {}}],
            "edges": [{
                "source": "src",
                "target": "chat-start",
                "targetHandle": "vars/topic",
                "sourceHandle": "output",
                "data": {"channel": "link"},
            }],
        }

        async def fake_materialize(_self: Any, source_id: str, _handle: str) -> Any:
            assert source_id == "src"
            return [
                {"value": "a", "label": "A"},
                {"value": "b", "label": "B"},
            ]

        with patch(
            "backend.services.variables.options_registry.GraphRuntime.materialize_output",
            fake_materialize,
        ):
            result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == [
            {"value": "a", "label": "A"},
            {"value": "b", "label": "B"},
        ]

    @pytest.mark.asyncio
    async def test_materialize_dict_with_options(self) -> None:
        graph = {
            "nodes": [{"id": "src", "type": "options-source", "data": {}}],
            "edges": [{
                "source": "src",
                "target": "chat-start",
                "targetHandle": "vars/topic",
                "sourceHandle": "output",
                "data": {"channel": "link"},
            }],
        }

        async def fake_materialize(_self: Any, _src_id: str, _handle: str) -> Any:
            return {"options": [{"value": "x", "label": "X"}]}

        with patch(
            "backend.services.variables.options_registry.GraphRuntime.materialize_output",
            fake_materialize,
        ):
            result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == [{"value": "x", "label": "X"}]

    @pytest.mark.asyncio
    async def test_materialize_bare_scalars_get_label(self) -> None:
        graph = {
            "nodes": [{"id": "src", "type": "options-source", "data": {}}],
            "edges": [{
                "source": "src",
                "target": "chat-start",
                "targetHandle": "vars/topic",
                "sourceHandle": "output",
                "data": {"channel": "link"},
            }],
        }

        async def fake_materialize(_self: Any, _src_id: str, _handle: str) -> Any:
            return ["red", "green"]

        with patch(
            "backend.services.variables.options_registry.GraphRuntime.materialize_output",
            fake_materialize,
        ):
            result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == [
            {"value": "red", "label": "red"},
            {"value": "green", "label": "green"},
        ]

    @pytest.mark.asyncio
    async def test_materialize_none_returns_empty(self) -> None:
        graph = {
            "nodes": [{"id": "src", "type": "options-source", "data": {}}],
            "edges": [{
                "source": "src",
                "target": "chat-start",
                "targetHandle": "vars/topic",
                "sourceHandle": "output",
                "data": {"channel": "link"},
            }],
        }

        async def fake_materialize(_self: Any, _src_id: str, _handle: str) -> Any:
            return None

        with patch(
            "backend.services.variables.options_registry.GraphRuntime.materialize_output",
            fake_materialize,
        ):
            result = await resolve_options_via_link(graph, "chat-start", "vars/topic")
        assert result == []
