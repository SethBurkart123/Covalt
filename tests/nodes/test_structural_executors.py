"""TDD specs for structural node executors (build() method).

These tests define the contract for executors that participate in Phase 1
graph compilation. They import from future module paths and are skipped
until the executors are implemented.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call

import pytest

# ── Guarded imports — will resolve once Phase 1 lands ───────────────
# These modules don't exist yet. We import them conditionally so pytest
# can collect (and skip) this file without ImportError.

try:
    from nodes._types import (
        AgentResult,
        BuildContext,
        MetadataResult,
        ToolsResult,
    )
    from nodes.core.agent.executor import AgentExecutor
    from nodes.core.chat_start.executor import ChatStartExecutor
    from nodes.tools.mcp_server.executor import McpServerExecutor
    from nodes.tools.toolset.executor import ToolsetExecutor

    _EXECUTORS_AVAILABLE = True
except ImportError:
    _EXECUTORS_AVAILABLE = False

    # Lightweight stand-ins so the file parses without error.
    class AgentResult:  # type: ignore[no-redef]
        pass

    class MetadataResult:  # type: ignore[no-redef]
        pass

    class ToolsResult:  # type: ignore[no-redef]
        pass

    class BuildContext:  # type: ignore[no-redef]
        pass

    class AgentExecutor:  # type: ignore[no-redef]
        node_type = "agent"

    class ChatStartExecutor:  # type: ignore[no-redef]
        node_type = "chat-start"

    class McpServerExecutor:  # type: ignore[no-redef]
        node_type = "mcp-server"

    class ToolsetExecutor:  # type: ignore[no-redef]
        node_type = "toolset"


pytestmark = pytest.mark.skipif(
    not _EXECUTORS_AVAILABLE,
    reason="Node executors not yet implemented",
)


# ── Helpers ─────────────────────────────────────────────────────────


def _build_ctx(
    *,
    node_id: str = "test-node",
    chat_id: str | None = "chat-1",
    tool_sources: list[dict[str, Any]] | None = None,
    sub_agents: list[Any] | None = None,
    tool_registry: Any | None = None,
) -> BuildContext:
    """Construct a BuildContext with sensible defaults."""
    return BuildContext(
        node_id=node_id,
        chat_id=chat_id,
        tool_sources=tool_sources or [],
        sub_agents=sub_agents or [],
        tool_registry=tool_registry or MagicMock(),
    )


# ====================================================================
# Chat Start executor
# ====================================================================


@pytest.mark.skip(reason="Executors not yet implemented")
class TestChatStartExecutor:
    """Chat Start produces MetadataResult with includeUserTools flag."""

    def test_include_user_tools_true(self) -> None:
        executor = ChatStartExecutor()
        result = executor.build({"includeUserTools": True}, _build_ctx())

        assert isinstance(result, MetadataResult)
        assert result.metadata["includeUserTools"] is True

    def test_include_user_tools_false_when_set(self) -> None:
        executor = ChatStartExecutor()
        result = executor.build({"includeUserTools": False}, _build_ctx())

        assert isinstance(result, MetadataResult)
        assert result.metadata["includeUserTools"] is False

    def test_include_user_tools_defaults_false_when_missing(self) -> None:
        executor = ChatStartExecutor()
        result = executor.build({}, _build_ctx())

        assert isinstance(result, MetadataResult)
        assert result.metadata["includeUserTools"] is False

    @pytest.mark.parametrize(
        "raw_value, expected",
        [
            (1, True),
            (0, False),
            ("yes", True),
            ("", False),
            (None, False),
            ([], False),
            ([1], True),
        ],
        ids=["int-1", "int-0", "str-yes", "str-empty", "none", "empty-list", "list"],
    )
    def test_truthy_falsy_coercion(self, raw_value: Any, expected: bool) -> None:
        executor = ChatStartExecutor()
        result = executor.build({"includeUserTools": raw_value}, _build_ctx())

        assert result.metadata["includeUserTools"] is expected

    def test_node_type_attribute(self) -> None:
        assert ChatStartExecutor().node_type == "chat-start"


# ====================================================================
# Agent executor
# ====================================================================


@pytest.mark.skip(reason="Executors not yet implemented")
class TestAgentExecutorBuild:
    """Agent.build() compiles an Agno Agent or Team."""

    def test_creates_agent_with_correct_model(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.MonkeyPatch.context() as mp:
            mock_model = MagicMock()
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: mock_model,
            )
            result = executor.build(
                {"model": "openai:gpt-4o", "name": "My Agent"},
                ctx,
            )

        assert isinstance(result, AgentResult)
        assert result.agent.name == "My Agent"
        assert result.agent.model is mock_model

    def test_creates_agent_with_instructions(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build(
                {"model": "openai:gpt-4o", "instructions": "Be helpful"},
                ctx,
            )

        assert result.agent.instructions == ["Be helpful"]

    def test_no_instructions_yields_none(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build({"model": "openai:gpt-4o"}, ctx)

        assert result.agent.instructions is None

    def test_default_name_is_agent(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build({"model": "openai:gpt-4o"}, ctx)

        assert result.agent.name == "Agent"

    def test_creates_team_when_sub_agents_present(self) -> None:
        sub_agent = MagicMock()
        ctx = _build_ctx(sub_agents=[sub_agent])
        executor = AgentExecutor()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build({"model": "openai:gpt-4o"}, ctx)

        assert isinstance(result, AgentResult)
        # Team has members attribute
        assert sub_agent in result.agent.members

    def test_collects_tools_from_tool_sources(self) -> None:
        tool_a, tool_b = MagicMock(), MagicMock()
        ctx = _build_ctx(
            tool_sources=[
                {"tools": [tool_a]},
                {"tools": [tool_b]},
            ]
        )
        executor = AgentExecutor()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build({"model": "openai:gpt-4o"}, ctx)

        assert tool_a in result.agent.tools
        assert tool_b in result.agent.tools

    def test_no_tools_passes_none(self) -> None:
        ctx = _build_ctx(tool_sources=[])
        executor = AgentExecutor()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "nodes.core.agent.executor.get_model",
                lambda p, m: MagicMock(),
            )
            result = executor.build({"model": "openai:gpt-4o"}, ctx)

        assert result.agent.tools is None

    def test_invalid_model_format_raises(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.raises(ValueError, match="Invalid model format"):
            executor.build({"model": "no-colon-here"}, ctx)

    def test_empty_model_raises(self) -> None:
        executor = AgentExecutor()
        ctx = _build_ctx()

        with pytest.raises(ValueError, match="Invalid model format"):
            executor.build({"model": ""}, ctx)

    def test_node_type_attribute(self) -> None:
        assert AgentExecutor().node_type == "agent"


# ====================================================================
# MCP Server executor
# ====================================================================


@pytest.mark.skip(reason="Executors not yet implemented")
class TestMcpServerExecutor:
    """MCP Server resolves tools via tool_registry with 'mcp:' prefix."""

    def test_resolve_with_mcp_prefix(self) -> None:
        registry = MagicMock()
        registry.resolve_tool_ids.return_value = [MagicMock()]
        ctx = _build_ctx(chat_id="chat-42", tool_registry=registry)

        executor = McpServerExecutor()
        result = executor.build({"server": "my-server"}, ctx)

        assert isinstance(result, ToolsResult)
        registry.resolve_tool_ids.assert_called_once_with(
            ["mcp:my-server"],
            chat_id="chat-42",
        )
        assert len(result.tools) == 1

    def test_empty_server_id_returns_empty(self) -> None:
        executor = McpServerExecutor()
        result = executor.build({"server": ""}, _build_ctx())

        assert isinstance(result, ToolsResult)
        assert result.tools == []

    def test_missing_server_key_returns_empty(self) -> None:
        executor = McpServerExecutor()
        result = executor.build({}, _build_ctx())

        assert isinstance(result, ToolsResult)
        assert result.tools == []

    def test_chat_id_forwarded(self) -> None:
        registry = MagicMock()
        registry.resolve_tool_ids.return_value = []
        ctx = _build_ctx(chat_id="abc-123", tool_registry=registry)

        executor = McpServerExecutor()
        executor.build({"server": "s1"}, ctx)

        _, kwargs = registry.resolve_tool_ids.call_args
        assert kwargs["chat_id"] == "abc-123"

    def test_node_type_attribute(self) -> None:
        assert McpServerExecutor().node_type == "mcp-server"


# ====================================================================
# Toolset executor
# ====================================================================


@pytest.mark.skip(reason="Executors not yet implemented")
class TestToolsetExecutor:
    """Toolset resolves tools via tool_registry with 'toolset:' prefix."""

    def test_resolve_with_toolset_prefix(self) -> None:
        registry = MagicMock()
        registry.resolve_tool_ids.return_value = [MagicMock(), MagicMock()]
        ctx = _build_ctx(tool_registry=registry)

        executor = ToolsetExecutor()
        result = executor.build({"toolset": "web-tools"}, ctx)

        assert isinstance(result, ToolsResult)
        registry.resolve_tool_ids.assert_called_once_with(
            ["toolset:web-tools"],
            chat_id=ctx.chat_id,
        )
        assert len(result.tools) == 2

    def test_empty_toolset_id_returns_empty(self) -> None:
        executor = ToolsetExecutor()
        result = executor.build({"toolset": ""}, _build_ctx())

        assert isinstance(result, ToolsResult)
        assert result.tools == []

    def test_missing_toolset_key_returns_empty(self) -> None:
        executor = ToolsetExecutor()
        result = executor.build({}, _build_ctx())

        assert isinstance(result, ToolsResult)
        assert result.tools == []

    def test_node_type_attribute(self) -> None:
        assert ToolsetExecutor().node_type == "toolset"
