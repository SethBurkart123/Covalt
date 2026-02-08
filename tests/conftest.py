"""Shared test fixtures and mock models for the Agno app test suite."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterator
from unittest.mock import MagicMock

import pytest
from agno.models.base import Model
from agno.models.response import ModelResponse


# ---------------------------------------------------------------------------
# Mock Models — drop-in replacements for real LLM providers
# ---------------------------------------------------------------------------


@dataclass
class MockModel(Model):
    """Fake agno Model that returns canned responses without API calls.

    Usage:
        model = MockModel(id="mock", response_text="Hello!")
        resp = model.invoke(messages=[...])
        assert resp.content == "Hello!"
    """

    id: str = "mock"
    response_text: str = "mock response"

    def invoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return ModelResponse(role="assistant", content=self.response_text)

    async def ainvoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return ModelResponse(role="assistant", content=self.response_text)

    def invoke_stream(self, *args: Any, **kwargs: Any) -> Iterator[ModelResponse]:
        yield ModelResponse(role="assistant", content=self.response_text)

    async def ainvoke_stream(
        self, *args: Any, **kwargs: Any
    ) -> AsyncIterator[ModelResponse]:
        yield ModelResponse(role="assistant", content=self.response_text)

    def _parse_provider_response(self, response: Any, **kwargs: Any) -> ModelResponse:
        return ModelResponse(role="assistant", content=self.response_text)

    def _parse_provider_response_delta(self, response: Any) -> ModelResponse:
        return ModelResponse(role="assistant", content=self.response_text)


@dataclass
class SequenceMockModel(Model):
    """Mock model that returns different responses on successive calls.

    Cycles through the list. Useful for testing tool-call loops where the
    first call returns a tool invocation and the second returns final text.

    Usage:
        model = SequenceMockModel(id="seq", responses=["first", "second"])
        assert model.invoke().content == "first"
        assert model.invoke().content == "second"
        assert model.invoke().content == "first"  # wraps around
    """

    id: str = "seq-mock"
    responses: list[str] = field(default_factory=lambda: ["mock response"])
    _call_index: int = field(default=0, repr=False)

    def _next_response(self) -> ModelResponse:
        text = self.responses[self._call_index % len(self.responses)]
        self._call_index += 1
        return ModelResponse(role="assistant", content=text)

    def invoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return self._next_response()

    async def ainvoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return self._next_response()

    def invoke_stream(self, *args: Any, **kwargs: Any) -> Iterator[ModelResponse]:
        yield self._next_response()

    async def ainvoke_stream(
        self, *args: Any, **kwargs: Any
    ) -> AsyncIterator[ModelResponse]:
        yield self._next_response()

    def _parse_provider_response(self, response: Any, **kwargs: Any) -> ModelResponse:
        return self._next_response()

    def _parse_provider_response_delta(self, response: Any) -> ModelResponse:
        return self._next_response()


# ---------------------------------------------------------------------------
# Context fixtures — minimal stand-ins for the graph executor contexts
# ---------------------------------------------------------------------------


@dataclass
class BuildContext:
    """Minimal build context for graph construction tests."""

    tool_registry: Any = field(default_factory=MagicMock)


@dataclass
class FlowContext:
    """Minimal flow context for runtime / streaming tests."""

    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    state: Any = field(default_factory=MagicMock)


@pytest.fixture
def build_ctx() -> BuildContext:
    return BuildContext()


@pytest.fixture
def flow_ctx() -> FlowContext:
    return FlowContext()


@pytest.fixture
def mock_model() -> MockModel:
    return MockModel()


# ---------------------------------------------------------------------------
# Async event helpers
# ---------------------------------------------------------------------------


async def collect_events(async_gen: AsyncIterator[Any]) -> tuple[list[Any], Any | None]:
    """Drain an async generator, separating intermediate events from a final result.

    Returns (events, final_result) where final_result is the last item
    if it differs in type from the preceding events, otherwise None.
    """
    items: list[Any] = []
    async for item in async_gen:
        items.append(item)

    if len(items) < 2:
        return items, None

    # If the last item is a different type, treat it as the final result
    if type(items[-1]) is not type(items[0]):
        return items[:-1], items[-1]
    return items, None


# ---------------------------------------------------------------------------
# Graph construction helpers
# ---------------------------------------------------------------------------


def make_node(
    node_id: str,
    node_type: str = "agent",
    *,
    name: str = "TestAgent",
    model: str = "openai:gpt-4o-mini",
    instructions: str = "",
    **extra_data: Any,
) -> dict[str, Any]:
    """Build a single node dict matching the graph schema."""
    data = {"name": name, "model": model, "instructions": instructions, **extra_data}
    return {"id": node_id, "type": node_type, "data": data}


def make_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal graph JSON structure from nodes and edges."""
    return {"nodes": nodes, "edges": edges or []}


def make_edge(
    source: str,
    target: str,
    source_handle: str = "agent",
    target_handle: str = "agent",
) -> dict[str, str]:
    """Build an edge dict for the graph schema."""
    return {
        "source": source,
        "target": target,
        "sourceHandle": source_handle,
        "targetHandle": target_handle,
    }


# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------


def assert_valid_topological_order(
    order: list[str],
    dependencies: dict[str, list[str]],
) -> None:
    """Validate that `order` respects dependency constraints.

    Args:
        order: List of node IDs in execution order.
        dependencies: Mapping of node_id -> list of node_ids that must come before it.
    """
    seen: set[str] = set()
    for node_id in order:
        for dep in dependencies.get(node_id, []):
            assert dep in seen, (
                f"Topological order violated: '{dep}' must appear before '{node_id}'. "
                f"Order so far: {list(seen)}"
            )
        seen.add(node_id)


def assert_event_order(
    actual: list[tuple[str, str]],
    expected: list[tuple[str, str]],
) -> None:
    """Validate that (node_id, event_type) pairs appear in expected order.

    Each expected pair must appear in `actual` in the given relative order,
    but other events may be interspersed.
    """
    idx = 0
    for pair in expected:
        while idx < len(actual) and actual[idx] != pair:
            idx += 1
        assert idx < len(actual), (
            f"Expected event {pair} not found in remaining events. "
            f"Full actual: {actual}"
        )
        idx += 1
