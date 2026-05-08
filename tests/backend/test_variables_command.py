"""Tests for backend/commands/variables.py."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from backend.commands import variables as variables_cmd
from backend.commands.variables import (
    GetChatVariableSpecsRequest,
    _resolve_specs_from_graph,
    get_chat_variable_specs,
)
from nodes._variables import node_model_variable_id


class _FakeAgentExecutor:
    def declare_variables(self, data: dict[str, Any], _ctx: Any) -> list[dict[str, Any]]:
        return [
            {
                "id": "model",
                "label": "Model",
                "control": {"kind": "searchable"},
                "default": data.get("model", ""),
            }
        ]


def _executors(**by_type: Any):
    def lookup(node_type: str) -> Any | None:
        return by_type.get(node_type)
    return lookup


def _graph_with_chat_start_and_agent() -> dict[str, Any]:
    return {
        "nodes": [
            {"id": "chat-start", "type": "chat-start", "data": {}},
            {"id": "agent-a", "type": "agent", "data": {"name": "Alpha", "model": "openai:gpt-4"}},
        ],
        "edges": [{
            "source": "chat-start",
            "target": "agent-a",
            "data": {"channel": "flow"},
        }],
    }


class TestResolveSpecsFromGraph:
    def test_empty_graph(self) -> None:
        with patch.object(variables_cmd, "get_executor", _executors()):
            specs, node_id = _resolve_specs_from_graph({})
        assert specs == []
        assert node_id is None

    def test_no_chat_start_returns_empty(self) -> None:
        graph = {"nodes": [{"id": "a", "type": "agent", "data": {}}], "edges": []}
        with patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            specs, node_id = _resolve_specs_from_graph(graph)
        assert specs == []
        assert node_id is None

    def test_returns_dict_payload(self) -> None:
        graph = _graph_with_chat_start_and_agent()
        with patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            specs, node_id = _resolve_specs_from_graph(graph)
        assert node_id == "chat-start"
        assert len(specs) == 1
        spec = specs[0]
        assert spec["id"] == node_model_variable_id("agent-a")
        assert spec["contributed_by"] == "Alpha"
        assert spec["default"] == "openai:gpt-4"

    def test_disabled_set_filters_contributor(self) -> None:
        graph = _graph_with_chat_start_and_agent()
        graph["nodes"][0]["data"] = {
            "disabledContributedVars": [node_model_variable_id("agent-a")],
        }
        with patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            specs, _ = _resolve_specs_from_graph(graph)
        assert specs == []

    def test_wired_model_input_skips_contributor(self) -> None:
        graph = _graph_with_chat_start_and_agent()
        graph["edges"].append({
            "source": "upstream",
            "target": "agent-a",
            "targetHandle": "model",
            "data": {"channel": "flow"},
        })
        with patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            specs, _ = _resolve_specs_from_graph(graph)
        assert specs == []


class TestGetChatVariableSpecs:
    @pytest.mark.asyncio
    async def test_explicit_graph_data_takes_precedence(self) -> None:
        graph = _graph_with_chat_start_and_agent()
        with patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            response = await get_chat_variable_specs(
                GetChatVariableSpecsRequest(graphData=graph)
            )
        assert response.nodeId == "chat-start"
        assert response.graphData == graph
        assert len(response.specs) == 1

    @pytest.mark.asyncio
    async def test_no_inputs_returns_empty(self) -> None:
        response = await get_chat_variable_specs(GetChatVariableSpecsRequest())
        assert response.specs == []
        assert response.nodeId is None
        assert response.graphData is None

    @pytest.mark.asyncio
    async def test_agent_id_falls_back_to_model_id_prefix(self) -> None:
        graph = _graph_with_chat_start_and_agent()

        def fake_agent_data(agent_id: str) -> dict[str, Any] | None:
            assert agent_id == "abc"
            return graph

        with patch.object(variables_cmd, "_agent_graph_data", fake_agent_data), \
             patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            response = await get_chat_variable_specs(
                GetChatVariableSpecsRequest(modelId="agent:abc")
            )
        assert response.nodeId == "chat-start"
        assert len(response.specs) == 1

    @pytest.mark.asyncio
    async def test_chat_id_falls_back_through_graph_loader(self) -> None:
        graph = _graph_with_chat_start_and_agent()

        def fake_loader(chat_id: str, _model_id: Any, model_options: dict[str, Any]) -> dict[str, Any]:
            assert chat_id == "chat-1"
            assert model_options == {}
            return graph

        with patch.object(variables_cmd, "get_graph_data_for_chat", fake_loader), \
             patch.object(variables_cmd, "get_executor", _executors(agent=_FakeAgentExecutor())):
            response = await get_chat_variable_specs(
                GetChatVariableSpecsRequest(chatId="chat-1")
            )
        assert response.nodeId == "chat-start"
        assert response.graphData == graph

    @pytest.mark.asyncio
    async def test_chat_loader_error_swallowed(self) -> None:
        def fake_loader(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("kaboom")

        with patch.object(variables_cmd, "get_graph_data_for_chat", fake_loader):
            response = await get_chat_variable_specs(
                GetChatVariableSpecsRequest(chatId="chat-1")
            )
        assert response.specs == []
        assert response.nodeId is None
        assert response.graphData is None
