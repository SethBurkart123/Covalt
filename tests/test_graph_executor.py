"""Regression tests for the graph executor — must pass before and after refactor."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest
from agno.agent import Agent
from agno.team import Team

from backend.services.graph_executor import GraphBuildResult, build_agent_from_graph
from tests.conftest import MockModel, make_edge, make_graph, make_node

# ---------------------------------------------------------------------------
# Shared mock setup
# ---------------------------------------------------------------------------

GX_PATH = "backend.services.graph_executor"
AGENT_EXEC_PATH = "nodes.core.agent.executor"

# A real Model subclass that passes agno's isinstance checks
_fake_model = MockModel(id="fake")


def _mock_registry(tools: list | None = None):
    """Build a mock tool registry that returns `tools` from resolve_tool_ids."""
    reg = MagicMock()
    reg.resolve_tool_ids.return_value = tools or []
    return reg


def _basic_graph(**chat_start_data) -> dict:
    """Chat Start -> Agent, the simplest valid graph."""
    return make_graph(
        nodes=[
            make_node("cs", "chat-start", name="Start", **chat_start_data),
            make_node(
                "a1",
                "agent",
                name="Helper",
                model="openai:gpt-4o",
                instructions="Be helpful",
                description="A helper agent",
            ),
        ],
        edges=[make_edge("cs", "a1")],
    )


# ===========================================================================
# 1. Graph parsing
# ===========================================================================


class TestGraphParsing:
    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_basic_graph_returns_agent(self, mock_model, mock_reg):
        result = build_agent_from_graph(_basic_graph())
        assert isinstance(result, GraphBuildResult)
        assert isinstance(result.agent, Agent)

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_agent_gets_correct_properties(self, mock_model, mock_reg):
        result = build_agent_from_graph(_basic_graph())
        assert result.agent.name == "Helper"
        assert result.agent.description == "A helper agent"
        assert result.agent.instructions == ["Be helpful"]

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_agent_model_resolved_with_correct_args(self, mock_model, mock_reg):
        build_agent_from_graph(_basic_graph())
        mock_model.assert_called_once_with("openai", "gpt-4o")

    @pytest.mark.parametrize("flag,expected", [(True, True), (False, False)])
    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_include_user_tools_flag(self, mock_model, mock_reg, flag, expected):
        result = build_agent_from_graph(_basic_graph(includeUserTools=flag))
        assert result.include_user_tools is expected

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_include_user_tools_defaults_false(self, mock_model, mock_reg):
        result = build_agent_from_graph(_basic_graph())
        assert result.include_user_tools is False

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_empty_instructions_omitted(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node(
                    "a1", "agent", name="A", model="openai:gpt-4o", instructions=""
                ),
            ],
            edges=[make_edge("cs", "a1")],
        )
        result = build_agent_from_graph(graph)
        assert result.agent.instructions is None


# ===========================================================================
# 2. Tool resolution
# ===========================================================================


class TestToolResolution:
    def test_mcp_server_tools_resolved(self):
        fake_tool = MagicMock(name="mcp_tool")
        reg = _mock_registry([fake_tool])

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = make_graph(
                nodes=[
                    make_node("cs", "chat-start", name="Start"),
                    make_node("a1", "agent", name="A", model="openai:gpt-4o"),
                    make_node("mcp1", "mcp-server", name="MCP", server="my-server"),
                ],
                edges=[
                    make_edge("cs", "a1"),
                    make_edge(
                        "mcp1", "a1", source_handle="tools", target_handle="tools"
                    ),
                ],
            )
            result = build_agent_from_graph(graph)

        reg.resolve_tool_ids.assert_any_call(["mcp:my-server"], chat_id=None)
        assert fake_tool in result.agent.tools

    def test_toolset_tools_resolved(self):
        fake_tool = MagicMock(name="toolset_tool")
        reg = _mock_registry([fake_tool])

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = make_graph(
                nodes=[
                    make_node("cs", "chat-start", name="Start"),
                    make_node("a1", "agent", name="A", model="openai:gpt-4o"),
                    make_node("ts1", "toolset", name="TS", toolset="web-search"),
                ],
                edges=[
                    make_edge("cs", "a1"),
                    make_edge(
                        "ts1", "a1", source_handle="tools", target_handle="tools"
                    ),
                ],
            )
            result = build_agent_from_graph(graph)

        reg.resolve_tool_ids.assert_any_call(["toolset:web-search"], chat_id=None)
        assert fake_tool in result.agent.tools

    def test_combined_mcp_and_toolset(self):
        tool_a, tool_b = MagicMock(name="tool_a"), MagicMock(name="tool_b")
        reg = MagicMock()
        reg.resolve_tool_ids.side_effect = lambda ids, **kw: (
            [tool_a] if ids == ["mcp:srv"] else [tool_b]
        )

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = make_graph(
                nodes=[
                    make_node("cs", "chat-start", name="Start"),
                    make_node("a1", "agent", name="A", model="openai:gpt-4o"),
                    make_node("mcp1", "mcp-server", name="MCP", server="srv"),
                    make_node("ts1", "toolset", name="TS", toolset="calc"),
                ],
                edges=[
                    make_edge("cs", "a1"),
                    make_edge(
                        "mcp1", "a1", source_handle="tools", target_handle="tools"
                    ),
                    make_edge(
                        "ts1", "a1", source_handle="tools", target_handle="tools"
                    ),
                ],
            )
            result = build_agent_from_graph(graph)

        assert tool_a in result.agent.tools
        assert tool_b in result.agent.tools

    def test_unknown_tool_source_logs_warning(self, caplog):
        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry()),
        ):
            graph = make_graph(
                nodes=[
                    make_node("cs", "chat-start", name="Start"),
                    make_node("a1", "agent", name="A", model="openai:gpt-4o"),
                    make_node("x1", "unknown-thing", name="X"),
                ],
                edges=[
                    make_edge("cs", "a1"),
                    make_edge("x1", "a1", source_handle="tools", target_handle="tools"),
                ],
            )
            with caplog.at_level(logging.WARNING):
                result = build_agent_from_graph(graph)

        assert isinstance(result.agent, Agent)
        assert "No executor for node type" in caplog.text


# ===========================================================================
# 3. Team creation (sub-agents)
# ===========================================================================


class TestTeamCreation:
    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_agent_with_sub_agent_creates_team(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node("leader", "agent", name="Leader", model="openai:gpt-4o"),
                make_node("worker", "agent", name="Worker", model="anthropic:claude-3"),
            ],
            edges=[
                make_edge("cs", "leader"),
                make_edge(
                    "worker", "leader", source_handle="tools", target_handle="tools"
                ),
            ],
        )
        result = build_agent_from_graph(graph)
        assert isinstance(result.agent, Team)
        assert result.agent.name == "Leader"
        assert len(result.agent.members) == 1
        assert result.agent.members[0].name == "Worker"

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_team_leader_model_resolved(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node("leader", "agent", name="L", model="openai:gpt-4o"),
                make_node("member", "agent", name="M", model="anthropic:claude-3"),
            ],
            edges=[
                make_edge("cs", "leader"),
                make_edge(
                    "member", "leader", source_handle="tools", target_handle="tools"
                ),
            ],
        )
        build_agent_from_graph(graph)
        assert mock_model.call_count == 2


# ===========================================================================
# 4. Error cases
# ===========================================================================


class TestErrorCases:
    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_no_chat_start_raises(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[make_node("a1", "agent", name="A", model="openai:gpt-4o")],
            edges=[],
        )
        with pytest.raises(ValueError, match="no Chat Start"):
            build_agent_from_graph(graph)

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_chat_start_not_connected_raises(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node("a1", "agent", name="A", model="openai:gpt-4o"),
            ],
            edges=[],
        )
        with pytest.raises(ValueError, match="not connected to an Agent"):
            build_agent_from_graph(graph)

    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_circular_reference_raises(self, mock_model, mock_reg):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node("a1", "agent", name="A", model="openai:gpt-4o"),
                make_node("a2", "agent", name="B", model="openai:gpt-4o"),
            ],
            edges=[
                make_edge("cs", "a1"),
                make_edge("a2", "a1", source_handle="tools", target_handle="tools"),
                make_edge("a1", "a2", source_handle="tools", target_handle="tools"),
            ],
        )
        with pytest.raises(ValueError, match="Circular reference"):
            build_agent_from_graph(graph)

    @pytest.mark.parametrize("bad_model", ["no-colon", "", "justtext"])
    @patch(f"{GX_PATH}.get_tool_registry", return_value=_mock_registry())
    @patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model)
    def test_invalid_model_format_raises(self, mock_model, mock_reg, bad_model):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start", name="Start"),
                make_node("a1", "agent", name="A", model=bad_model),
            ],
            edges=[make_edge("cs", "a1")],
        )
        with pytest.raises(ValueError, match="Invalid model format"):
            build_agent_from_graph(graph)


# ===========================================================================
# 5. Extra tools merging
# ===========================================================================


class TestExtraToolsMerging:
    def test_user_tools_merged_when_flag_true(self):
        user_tool = MagicMock(name="user_tool")
        reg = MagicMock()
        reg.resolve_tool_ids.return_value = [user_tool]

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = _basic_graph(includeUserTools=True)
            result = build_agent_from_graph(graph, extra_tool_ids=["tool:custom"])

        assert user_tool in result.agent.tools

    def test_user_tools_not_merged_when_flag_false(self):
        user_tool = MagicMock(name="user_tool")
        reg = _mock_registry([user_tool])

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = _basic_graph(includeUserTools=False)
            result = build_agent_from_graph(graph, extra_tool_ids=["tool:custom"])

        assert not result.agent.tools  # empty or None — no user tools merged

    def test_user_tools_chat_id_forwarded(self):
        reg = MagicMock()
        reg.resolve_tool_ids.return_value = [MagicMock()]

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = _basic_graph(includeUserTools=True)
            build_agent_from_graph(graph, chat_id="c-123", extra_tool_ids=["t:1"])

        reg.resolve_tool_ids.assert_any_call(["t:1"], chat_id="c-123")

    def test_no_extra_tool_ids_no_merge(self):
        reg = _mock_registry()

        with (
            patch(f"{AGENT_EXEC_PATH}.get_model", return_value=_fake_model),
            patch(f"{GX_PATH}.get_tool_registry", return_value=reg),
        ):
            graph = _basic_graph(includeUserTools=True)
            result = build_agent_from_graph(graph, extra_tool_ids=None)

        assert not result.agent.tools  # empty or None — no extra tools merged
