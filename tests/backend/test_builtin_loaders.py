"""Tests for backend/services/variables/builtin_loaders.py."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import patch

import pytest

from backend.services.variables import builtin_loaders, options_registry
from backend.services.variables.builtin_loaders import (
    _list_agents,
    _list_models,
    register_builtin_loaders,
)


@pytest.fixture(autouse=True)
def _isolate_loaders() -> Iterator[None]:
    saved = dict(options_registry._loaders)
    options_registry._loaders.clear()
    yield
    options_registry._loaders.clear()
    options_registry._loaders.update(saved)


async def _empty_batches() -> AsyncIterator[tuple[str, list[dict[str, Any]], bool]]:
    if False:
        yield ("", [], True)


async def _fixed_batches(
    payload: list[tuple[str, list[dict[str, Any]], bool]],
) -> AsyncIterator[tuple[str, list[dict[str, Any]], bool]]:
    for item in payload:
        yield item


class TestListModels:
    @pytest.mark.asyncio
    async def test_empty_when_no_providers(self) -> None:
        with patch.object(builtin_loaders, "stream_available_model_batches", _empty_batches):
            result = await _list_models({})
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_documented_shape_and_sorted(self) -> None:
        payload = [
            ("openai", [
                {"modelId": "gpt-4o", "displayName": "GPT-4o"},
                {"modelId": "gpt-3.5", "displayName": "GPT-3.5"},
            ], False),
            ("anthropic", [
                {"modelId": "claude-3-5", "displayName": "Claude 3.5"},
            ], True),
        ]

        async def stream() -> AsyncIterator[tuple[str, list[dict[str, Any]], bool]]:
            async for item in _fixed_batches(payload):
                yield item

        with patch.object(builtin_loaders, "stream_available_model_batches", stream):
            result = await _list_models({})

        assert result == [
            {"value": "anthropic:claude-3-5", "label": "Claude 3.5", "group": "anthropic"},
            {"value": "openai:gpt-3.5", "label": "GPT-3.5", "group": "openai"},
            {"value": "openai:gpt-4o", "label": "GPT-4o", "group": "openai"},
        ]

    @pytest.mark.asyncio
    async def test_skips_models_without_id(self) -> None:
        payload = [(
            "openai",
            [
                {"modelId": "", "displayName": "Empty"},
                {"modelId": "gpt-4o"},
            ],
            True,
        )]

        async def stream() -> AsyncIterator[tuple[str, list[dict[str, Any]], bool]]:
            async for item in _fixed_batches(payload):
                yield item

        with patch.object(builtin_loaders, "stream_available_model_batches", stream):
            result = await _list_models({})

        assert result == [{"value": "openai:gpt-4o", "label": "gpt-4o", "group": "openai"}]


class _FakeAgentManager:
    def __init__(self, agents: list[Any]) -> None:
        self._agents = agents

    def list_agents(self) -> list[Any]:
        return self._agents


class _BrokenAgentManager:
    def list_agents(self) -> list[Any]:
        raise RuntimeError("db down")


class TestListAgents:
    @pytest.mark.asyncio
    async def test_returns_options(self) -> None:
        manager = _FakeAgentManager([
            {"id": "a-1", "name": "Beta"},
            {"id": "a-2", "name": "Alpha"},
        ])
        with patch.object(builtin_loaders, "get_agent_manager", lambda: manager):
            result = await _list_agents({})
        assert result == [
            {"value": "agent:a-2", "label": "Alpha", "group": "Agents"},
            {"value": "agent:a-1", "label": "Beta", "group": "Agents"},
        ]

    @pytest.mark.asyncio
    async def test_falls_back_to_id_when_name_missing(self) -> None:
        manager = _FakeAgentManager([{"id": "a-1"}])
        with patch.object(builtin_loaders, "get_agent_manager", lambda: manager):
            result = await _list_agents({})
        assert result == [{"value": "agent:a-1", "label": "a-1", "group": "Agents"}]

    @pytest.mark.asyncio
    async def test_drops_malformed_entries(self) -> None:
        manager = _FakeAgentManager([
            "not a dict",
            {"id": "", "name": "blank id"},
            {"id": "ok", "name": "OK"},
        ])
        with patch.object(builtin_loaders, "get_agent_manager", lambda: manager):
            result = await _list_agents({})
        assert result == [{"value": "agent:ok", "label": "OK", "group": "Agents"}]

    @pytest.mark.asyncio
    async def test_swallows_manager_errors(self) -> None:
        with patch.object(builtin_loaders, "get_agent_manager", _BrokenAgentManager):
            result = await _list_agents({})
        assert result == []


class TestRegisterBuiltinLoaders:
    def test_registers_known_loaders(self) -> None:
        register_builtin_loaders()
        assert "models:list" in options_registry._loaders
        assert "agents:list" in options_registry._loaders

    def test_idempotent(self) -> None:
        register_builtin_loaders()
        register_builtin_loaders()
        assert "models:list" in options_registry._loaders
        assert "agents:list" in options_registry._loaders
