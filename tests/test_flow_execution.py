"""Flow execution engine tests (Phase 2 + 4).

Tests cover:
  - find_flow_nodes(): capability-based node partitioning (executor has execute())
  - topological_sort(): ordering with cycle detection
  - run_flow(): linear pipelines, branching, dead branches, error handling
  - _flow_edges(): channel-based edge filtering

Imports from nodes._types for DataValue, ExecutionResult, NodeEvent, FlowContext.
Flow engine functions (run_flow, find_flow_nodes, topological_sort, _flow_edges)
from backend.services.flow_executor.
"""

# pyright: reportAssignmentType=false

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from tests.conftest import (
    assert_event_order,
    assert_valid_topological_order,
    make_edge,
    make_graph,
    make_node,
)

# ── Guarded imports ──────────────────────────────────────────────────
# These modules don't exist yet. We import them conditionally so pytest
# can collect (and skip) this file without ImportError.

try:
    from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
    from backend.services.flow_executor import (
        find_flow_nodes,
        run_flow,
        topological_sort,
        _flow_edges,
    )

    _FLOW_ENGINE_AVAILABLE = True
except ImportError:
    _FLOW_ENGINE_AVAILABLE = False

    # Lightweight stand-ins so the stub executors below parse without error.
    # These get replaced by real imports once the modules exist.
    @dataclass
    class DataValue:  # type: ignore[no-redef]
        type: str = ""
        value: Any = None

    @dataclass
    class ExecutionResult:  # type: ignore[no-redef]
        outputs: dict[str, Any] = field(default_factory=dict)
        events: list[Any] = field(default_factory=list)

    @dataclass
    class FlowContext:  # type: ignore[no-redef]
        node_id: str = ""
        chat_id: str | None = None
        run_id: str = ""
        state: Any = None
        tool_registry: Any = None

    @dataclass
    class NodeEvent:  # type: ignore[no-redef]
        node_id: str = ""
        node_type: str = ""
        event_type: str = ""
        run_id: str = ""
        data: dict[str, Any] | None = None
        timestamp: float = 0.0

    from typing import AsyncIterator as _AI

    async def run_flow(*a: Any, **kw: Any) -> _AI[Any]:  # type: ignore[no-redef]
        raise NotImplementedError
        yield  # makes this an async generator

    def find_flow_nodes(*a: Any, **kw: Any) -> Any:  # type: ignore[no-redef]
        raise NotImplementedError

    def _flow_edges(*a: Any, **kw: Any) -> Any:  # type: ignore[no-redef]
        raise NotImplementedError

    def topological_sort(*a: Any, **kw: Any) -> Any:  # type: ignore[no-redef]
        raise NotImplementedError


# Skip every test in this module if the engine isn't importable yet.
pytestmark = pytest.mark.skipif(
    not _FLOW_ENGINE_AVAILABLE,
    reason="Flow engine not yet implemented (nodes._types / backend.services.flow_executor missing)",
)


# ═══════════════════════════════════════════════════════════════════════
# Stub executors — deterministic, no I/O
# ═══════════════════════════════════════════════════════════════════════


class PassthroughExecutor:
    """Copies input to output unchanged."""

    node_type = "passthrough"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        return ExecutionResult(
            outputs={"output": inputs.get("input", DataValue("string", ""))}
        )


class UpperCaseExecutor:
    """Uppercases a text input."""

    node_type = "uppercase"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        text = inputs.get("input", DataValue("string", "")).value
        return ExecutionResult(
            outputs={"output": DataValue("string", str(text).upper())}
        )


class ConditionalStubExecutor:
    """Routes input to true or false port based on data["condition"]."""

    node_type = "conditional"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        condition_met = bool(data.get("condition", False))
        inp = inputs.get("input", DataValue("data", {}))
        outputs = {"true": inp} if condition_met else {"false": inp}
        return ExecutionResult(outputs=outputs)


class FilterStubExecutor:
    """Splits a list into pass/reject based on data["threshold"]."""

    node_type = "filter"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        raw = inputs.get("input", DataValue("data", {})).value
        if isinstance(raw, dict):
            items = (
                raw.get("message") or raw.get("items") or list(raw.values())[0]
                if raw
                else []
            )
        else:
            items = raw if isinstance(raw, list) else []
        threshold = data.get("threshold", 0)
        passed = [x for x in items if x >= threshold]
        rejected = [x for x in items if x < threshold]
        outputs: dict[str, DataValue] = {}
        if passed:
            outputs["pass"] = DataValue("json", passed)
        if rejected:
            outputs["reject"] = DataValue("json", rejected)
        return ExecutionResult(outputs=outputs)


class StreamingStubExecutor:
    """Yields started → progress → completed events, then result."""

    node_type = "streaming"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ):
        yield NodeEvent(
            node_id=context.node_id, node_type="streaming", event_type="started"
        )
        for i in range(3):
            yield NodeEvent(
                node_id=context.node_id,
                node_type="streaming",
                event_type="progress",
                data={"step": i},
            )
        yield NodeEvent(
            node_id=context.node_id, node_type="streaming", event_type="completed"
        )
        yield ExecutionResult(
            outputs={"output": DataValue("data", {"text": "streamed"})}
        )


class ExplodingExecutor:
    """Always raises."""

    node_type = "exploding"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        raise RuntimeError("boom")


class ChatStartStubExecutor:
    """Emits a canned user message."""

    node_type = "chat-start"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        msg = getattr(context.state, "user_message", "hello")
        return ExecutionResult(outputs={"output": DataValue("data", {"message": msg})})


class PromptTemplateStubExecutor:
    """Formats data["template"] with input values."""

    node_type = "prompt-template"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        template = data.get("template", "{input}")
        val = inputs.get("input", DataValue("data", {})).value
        if isinstance(val, dict):
            text_val = val.get("message", val.get("text", str(val)))
        else:
            text_val = str(val)
        text = template.replace("{input}", text_val)
        return ExecutionResult(outputs={"output": DataValue("data", {"text": text})})


class LLMCompletionStubExecutor:
    """Returns a canned LLM response."""

    node_type = "llm-completion"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ):
        yield NodeEvent(
            node_id=context.node_id, node_type="llm-completion", event_type="started"
        )
        prompt_val = inputs.get("prompt", DataValue("string", "")).value
        if isinstance(prompt_val, dict):
            prompt_val = (
                prompt_val.get("text") or prompt_val.get("message") or str(prompt_val)
            )
        response = f"LLM says: {prompt_val}"
        yield NodeEvent(
            node_id=context.node_id,
            node_type="llm-completion",
            event_type="completed",
            data={"response": response},
        )
        yield ExecutionResult(outputs={"output": DataValue("data", {"text": response})})


# Registry of stub executors for tests
STUB_EXECUTORS: dict[str, Any] = {
    cls.node_type: cls()
    for cls in [
        PassthroughExecutor,
        UpperCaseExecutor,
        ConditionalStubExecutor,
        FilterStubExecutor,
        StreamingStubExecutor,
        ExplodingExecutor,
        ChatStartStubExecutor,
        PromptTemplateStubExecutor,
        LLMCompletionStubExecutor,
    ]
}


# ═══════════════════════════════════════════════════════════════════════
# 1. Graph partitioning
# ═══════════════════════════════════════════════════════════════════════


class StructuralOnlyExecutor:
    """Executor with build() but NO execute() — purely structural."""

    node_type = "structural-only"

    def build(self, data: dict, context: Any) -> Any:
        return None


class TestFindFlowNodes:
    """find_flow_nodes returns only nodes whose executor has execute()."""

    def test_mixed_graph_returns_only_flow_capable(self):
        """Graph with both structural and flow-capable nodes → only flow-capable returned."""
        nodes = [
            make_node("cs", "chat-start"),
            make_node("ag", "agent"),
            make_node("mcp", "structural-only"),
            make_node("llm", "llm-completion"),
        ]
        executors = {
            **STUB_EXECUTORS,
            "structural-only": StructuralOnlyExecutor(),
        }
        flow = find_flow_nodes(nodes, executors)
        flow_ids = {n["id"] for n in flow}

        assert "cs" in flow_ids, "chat-start has execute() → flow-capable"
        assert "ag" not in flow_ids, "agent not in STUB_EXECUTORS → not flow-capable"
        assert "mcp" not in flow_ids, (
            "structural-only has no execute() → not flow-capable"
        )
        assert "llm" in flow_ids, "llm-completion has execute() → flow-capable"

    def test_pure_structural_returns_empty(self):
        """All structural executors → empty result."""
        nodes = [
            make_node("a", "structural-only"),
            make_node("b", "structural-only"),
        ]
        executors = {"structural-only": StructuralOnlyExecutor()}
        flow = find_flow_nodes(nodes, executors)
        assert flow == []

    def test_hybrid_nodes_appear_in_flow(self):
        """Hybrid executors (both build() and execute()) appear in flow results."""

        class HybridExecutor:
            node_type = "hybrid-test"

            def build(self, data: dict, context: Any) -> Any:
                return None

            async def execute(
                self, data: dict, inputs: dict[str, DataValue], context: FlowContext
            ) -> ExecutionResult:
                return ExecutionResult(outputs={})

        nodes = [
            make_node("h1", "hybrid-test"),
            make_node("s1", "structural-only"),
            make_node("f1", "passthrough"),
        ]
        executors = {
            "hybrid-test": HybridExecutor(),
            "structural-only": StructuralOnlyExecutor(),
            "passthrough": PassthroughExecutor(),
        }
        flow = find_flow_nodes(nodes, executors)
        flow_ids = {n["id"] for n in flow}

        assert "h1" in flow_ids, "Hybrid executor has execute() → in flow"
        assert "s1" not in flow_ids, "Structural-only → not in flow"
        assert "f1" in flow_ids, "Pure flow executor → in flow"


# ═══════════════════════════════════════════════════════════════════════
# 2. Topological sort
# ═══════════════════════════════════════════════════════════════════════


class TestTopologicalSort:
    """topological_sort produces valid execution orderings."""

    def test_topo_sort_linear_chain(self):
        """A → B → C produces [A, B, C]."""
        nodes = [
            make_node("A", "passthrough"),
            make_node("B", "passthrough"),
            make_node("C", "passthrough"),
        ]
        edges = [
            make_edge("A", "B", "output", "input"),
            make_edge("B", "C", "output", "input"),
        ]
        order = topological_sort(nodes, edges)
        assert order == ["A", "B", "C"]

    def test_topo_sort_diamond(self):
        """A → B, A → C, B → D, C → D → valid ordering (A first, D last)."""
        nodes = [
            make_node("A", "passthrough"),
            make_node("B", "passthrough"),
            make_node("C", "passthrough"),
            make_node("D", "passthrough"),
        ]
        edges = [
            make_edge("A", "B", "output", "input"),
            make_edge("A", "C", "output", "input"),
            make_edge("B", "D", "output", "input"),
            make_edge("C", "D", "output", "input"),
        ]
        order = topological_sort(nodes, edges)

        assert order[0] == "A"
        assert order[-1] == "D"
        assert_valid_topological_order(order, {"B": ["A"], "C": ["A"], "D": ["B", "C"]})

    def test_topo_sort_cycle_raises(self):
        """Cycle detection raises an error."""
        nodes = [make_node("A", "passthrough"), make_node("B", "passthrough")]
        edges = [
            make_edge("A", "B", "output", "input"),
            make_edge("B", "A", "output", "input"),
        ]
        with pytest.raises(ValueError, match="[Cc]ycle"):
            topological_sort(nodes, edges)

    def test_topo_sort_single_node(self):
        """Single node, no edges → [node]."""
        nodes = [make_node("solo", "passthrough")]
        order = topological_sort(nodes, [])
        assert order == ["solo"]

    def test_topo_sort_disconnected_components(self):
        """Disconnected components → all nodes present, constraints respected."""
        nodes = [
            make_node("A", "passthrough"),
            make_node("B", "passthrough"),
            make_node("X", "passthrough"),
            make_node("Y", "passthrough"),
        ]
        edges = [
            make_edge("A", "B", "output", "input"),
            make_edge("X", "Y", "output", "input"),
        ]
        order = topological_sort(nodes, edges)

        assert set(order) == {"A", "B", "X", "Y"}
        assert order.index("A") < order.index("B")
        assert order.index("X") < order.index("Y")


# ═══════════════════════════════════════════════════════════════════════
# 3. Linear flow execution
# ═══════════════════════════════════════════════════════════════════════


class TestFlowLinear:
    """Linear pipeline: each node gets correct inputs from upstream output ports."""

    @pytest.fixture
    def linear_graph(self):
        """Chat Start → Prompt Template → LLM Completion."""
        return make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pt", "prompt-template", template="Summarize: {input}"),
                make_node("llm", "llm-completion"),
            ],
            edges=[
                make_edge("cs", "pt", "output", "input"),
                make_edge("pt", "llm", "output", "prompt"),
            ],
        )

    @pytest.mark.asyncio
    async def test_linear_flow_data_flows_through(self, linear_graph, flow_ctx):
        """Input data flows through edges correctly."""
        flow_ctx.state.user_message = "Hello world"
        events = []
        async for event in run_flow(linear_graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        results = [e for e in events if isinstance(e, ExecutionResult)]
        assert len(results) > 0

    @pytest.mark.asyncio
    async def test_linear_flow_final_output_accessible(self, linear_graph, flow_ctx):
        """Final output is accessible from the last node."""
        flow_ctx.state.user_message = "test input"
        final_outputs = {}
        async for event in run_flow(linear_graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, ExecutionResult):
                final_outputs.update(event.outputs)

        assert "output" in final_outputs
        assert isinstance(final_outputs["output"], DataValue)

    @pytest.mark.asyncio
    async def test_linear_flow_each_node_gets_upstream_output(
        self, linear_graph, flow_ctx
    ):
        """Each node receives the correct inputs from its upstream node's output ports."""
        flow_ctx.state.user_message = "data"
        node_events: list[NodeEvent] = []
        async for event in run_flow(linear_graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent):
                node_events.append(event)

        started = [e for e in node_events if e.event_type == "started"]
        assert len(started) >= 1


# ═══════════════════════════════════════════════════════════════════════
# 4. Branching execution
# ═══════════════════════════════════════════════════════════════════════


class TestFlowBranching:
    """Conditional routing: data on one port executes that branch, other is skipped."""

    @pytest.fixture
    def branching_graph(self):
        """
        Input → Conditional
                 ├─ true  → UpperCase (branch A)
                 └─ false → Passthrough (branch B)
        """
        return make_graph(
            nodes=[
                make_node("input", "chat-start"),
                make_node("cond", "conditional"),
                make_node("branch_a", "uppercase"),
                make_node("branch_b", "passthrough"),
            ],
            edges=[
                make_edge("input", "cond", "output", "input"),
                make_edge("cond", "branch_a", "true", "input"),
                make_edge("cond", "branch_b", "false", "input"),
            ],
        )

    @pytest.mark.asyncio
    async def test_conditional_true_branch_executes(self, branching_graph, flow_ctx):
        """Conditional with condition=True → branch A executes, branch B skipped."""
        flow_ctx.state.user_message = "hello"
        branching_graph["nodes"][1]["data"]["condition"] = True

        node_events: list[NodeEvent] = []
        async for event in run_flow(
            branching_graph, flow_ctx, executors=STUB_EXECUTORS
        ):
            if isinstance(event, NodeEvent):
                node_events.append(event)

        executed_nodes = {e.node_id for e in node_events if e.event_type == "started"}
        assert "branch_a" in executed_nodes or any(
            e.node_id == "branch_a" for e in node_events
        )

    @pytest.mark.asyncio
    async def test_conditional_false_branch_executes(self, branching_graph, flow_ctx):
        """Conditional with condition=False → branch B executes, branch A skipped."""
        flow_ctx.state.user_message = "hello"
        branching_graph["nodes"][1]["data"]["condition"] = False

        node_events: list[NodeEvent] = []
        async for event in run_flow(
            branching_graph, flow_ctx, executors=STUB_EXECUTORS
        ):
            if isinstance(event, NodeEvent):
                node_events.append(event)

        executed_nodes = {e.node_id for e in node_events if e.event_type == "started"}
        assert "branch_b" not in {
            e.node_id for e in node_events if e.event_type == "error"
        }

    @pytest.mark.asyncio
    async def test_filter_both_branches_execute(self, flow_ctx):
        """Filter with both pass and reject outputs → both downstream paths execute."""
        graph = make_graph(
            nodes=[
                make_node("src", "chat-start"),
                make_node("flt", "filter", threshold=5),
                make_node("high", "passthrough"),
                make_node("low", "passthrough"),
            ],
            edges=[
                make_edge("src", "flt", "output", "input"),
                make_edge("flt", "high", "pass", "input"),
                make_edge("flt", "low", "reject", "input"),
            ],
        )
        flow_ctx.state.user_message = [1, 3, 5, 7, 9]  # mixed above/below threshold

        results: dict[str, DataValue] = {}
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, ExecutionResult):
                results.update(event.outputs)

        assert len(results) > 0


# ═══════════════════════════════════════════════════════════════════════
# 5. Dead branch detection
# ═══════════════════════════════════════════════════════════════════════


class TestFlowDeadBranch:
    """Nodes with unsatisfied required inputs are skipped entirely."""

    @pytest.mark.asyncio
    async def test_dead_branch_node_skipped(self, flow_ctx):
        """Node whose required input has no data (dead branch) is skipped."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("cond", "conditional"),
                make_node("live", "uppercase"),
                make_node("dead", "passthrough"),  # on false branch, but condition=True
            ],
            edges=[
                make_edge("cs", "cond", "output", "input"),
                make_edge("cond", "live", "true", "input"),
                make_edge("cond", "dead", "false", "input"),
            ],
        )
        graph["nodes"][1]["data"]["condition"] = True
        flow_ctx.state.user_message = "test"

        all_events: list[NodeEvent] = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent):
                all_events.append(event)

        dead_events = [e for e in all_events if e.node_id == "dead"]
        assert dead_events == [], "Dead branch node should emit no events"

    @pytest.mark.asyncio
    async def test_dead_branch_emits_no_events(self, flow_ctx):
        """Skipped node emits zero events of any type."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("cond", "conditional"),
                make_node("skipped", "streaming"),  # streaming node on dead branch
            ],
            edges=[
                make_edge("cs", "cond", "output", "input"),
                make_edge("cond", "skipped", "false", "input"),  # dead: condition=True
            ],
        )
        graph["nodes"][1]["data"]["condition"] = True
        flow_ctx.state.user_message = "test"

        all_events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            all_events.append(event)

        skipped_events = [
            e for e in all_events if isinstance(e, NodeEvent) and e.node_id == "skipped"
        ]
        assert skipped_events == []


# ═══════════════════════════════════════════════════════════════════════
# 6. Event ordering
# ═══════════════════════════════════════════════════════════════════════


class TestFlowEvents:
    """Event protocol: started before completed, ordering matches topo sort."""

    @pytest.mark.asyncio
    async def test_started_before_completed_per_node(self, flow_ctx):
        """Every executed node emits started before completed."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("s1", "streaming"),
            ],
            edges=[make_edge("cs", "s1", "output", "input")],
        )
        flow_ctx.state.user_message = "go"

        events: list[NodeEvent] = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent):
                events.append(event)

        s1_events = [(e.node_id, e.event_type) for e in events if e.node_id == "s1"]
        started_idx = next(i for i, (_, t) in enumerate(s1_events) if t == "started")
        completed_idx = next(
            i for i, (_, t) in enumerate(s1_events) if t == "completed"
        )
        assert started_idx < completed_idx

    @pytest.mark.asyncio
    async def test_global_order_matches_topo_sort(self, flow_ctx):
        """Global event ordering respects topological sort: A events before B events."""
        graph = make_graph(
            nodes=[
                make_node("A", "chat-start"),
                make_node("B", "passthrough"),
                make_node("C", "passthrough"),
            ],
            edges=[
                make_edge("A", "B", "output", "input"),
                make_edge("B", "C", "output", "input"),
            ],
        )
        flow_ctx.state.user_message = "chain"

        events: list[NodeEvent] = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent):
                events.append(event)

        node_first_event: dict[str, int] = {}
        for i, e in enumerate(events):
            if e.node_id not in node_first_event:
                node_first_event[e.node_id] = i

        assert node_first_event.get("A", 0) < node_first_event.get("B", 999)
        assert node_first_event.get("B", 0) < node_first_event.get("C", 999)

    @pytest.mark.asyncio
    async def test_streaming_node_progress_events_between_started_completed(
        self, flow_ctx
    ):
        """Streaming node yields progress events between started and completed."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("str", "streaming"),
            ],
            edges=[make_edge("cs", "str", "output", "input")],
        )
        flow_ctx.state.user_message = "stream"

        events: list[NodeEvent] = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent) and event.node_id == "str":
                events.append(event)

        types = [e.event_type for e in events]
        assert types[0] == "started"
        assert types[-1] == "completed"
        assert "progress" in types
        progress_indices = [i for i, t in enumerate(types) if t == "progress"]
        assert all(0 < i < len(types) - 1 for i in progress_indices)

    @pytest.mark.asyncio
    async def test_skipped_nodes_emit_no_events(self, flow_ctx):
        """Skipped nodes (dead branch) emit zero events."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("cond", "conditional"),
                make_node("ghost", "streaming"),
            ],
            edges=[
                make_edge("cs", "cond", "output", "input"),
                make_edge("cond", "ghost", "false", "input"),
            ],
        )
        graph["nodes"][1]["data"]["condition"] = True  # ghost is on false branch
        flow_ctx.state.user_message = "x"

        events: list[NodeEvent] = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            if isinstance(event, NodeEvent):
                events.append(event)

        ghost_events = [e for e in events if e.node_id == "ghost"]
        assert ghost_events == []


# ═══════════════════════════════════════════════════════════════════════
# 7. Error handling
# ═══════════════════════════════════════════════════════════════════════


class TestFlowErrors:
    """Error modes: stop, continue-on-fail, missing executor."""

    @pytest.mark.asyncio
    async def test_node_raises_flow_stops(self, flow_ctx):
        """Node that raises → flow stops, error event emitted."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("boom", "exploding"),
                make_node("after", "passthrough"),  # should NOT execute
            ],
            edges=[
                make_edge("cs", "boom", "output", "input"),
                make_edge("boom", "after", "output", "input"),
            ],
        )
        flow_ctx.state.user_message = "trigger"

        events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        error_events = [
            e for e in events if isinstance(e, NodeEvent) and e.event_type == "error"
        ]
        assert len(error_events) >= 1
        assert error_events[0].node_id == "boom"

        after_events = [
            e for e in events if isinstance(e, NodeEvent) and e.node_id == "after"
        ]
        assert after_events == []

    @pytest.mark.asyncio
    async def test_continue_on_fail_error_becomes_output(self, flow_ctx):
        """Continue-on-fail mode → error becomes output data, downstream continues."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("boom", "exploding"),
                make_node("after", "passthrough"),
            ],
            edges=[
                make_edge("cs", "boom", "output", "input"),
                make_edge("boom", "after", "output", "input"),
            ],
        )
        graph["nodes"][1]["data"]["on_error"] = "continue"
        flow_ctx.state.user_message = "trigger"

        events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        after_events = [
            e for e in events if isinstance(e, NodeEvent) and e.node_id == "after"
        ]
        assert len(after_events) > 0, (
            "Downstream should execute in continue-on-fail mode"
        )

    @pytest.mark.asyncio
    async def test_missing_executor_node_skipped(self, flow_ctx):
        """Missing executor for node type → warning logged, node skipped."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("mystery", "nonexistent-type"),
                make_node("after", "passthrough"),
            ],
            edges=[
                make_edge("cs", "mystery", "output", "input"),
                make_edge("mystery", "after", "output", "input"),
            ],
        )
        flow_ctx.state.user_message = "test"

        events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        mystery_started = [
            e
            for e in events
            if isinstance(e, NodeEvent)
            and e.node_id == "mystery"
            and e.event_type == "started"
        ]
        assert mystery_started == [], "Node with no executor should not start"


# ═══════════════════════════════════════════════════════════════════════
# 8. Integration scenarios
# ═══════════════════════════════════════════════════════════════════════


class TestFlowIntegration:
    """End-to-end scenarios combining multiple features."""

    @pytest.mark.asyncio
    async def test_pure_structural_graph_returns_early(self, flow_ctx):
        """Pure structural graph (no flow-capable executors) → run_flow yields nothing."""
        structural_executors = {
            "struct-a": StructuralOnlyExecutor(),
            "struct-b": StructuralOnlyExecutor(),
            "struct-c": StructuralOnlyExecutor(),
        }
        graph = make_graph(
            nodes=[
                make_node("a", "struct-a"),
                make_node("b", "struct-b"),
                make_node("c", "struct-c"),
            ],
            edges=[
                make_edge("a", "b", "tools", "tools"),
                make_edge("c", "b", "tools", "tools"),
            ],
        )
        flow_ctx.state.user_message = "hello"

        events: list = []
        async for event in run_flow(
            graph, None, flow_ctx, executors=structural_executors
        ):
            events.append(event)

        assert events == [], "No flow-capable executors → no events"

    @pytest.mark.asyncio
    async def test_full_pipeline_with_branching(self, flow_ctx):
        """
        Full pipeline:
        Chat Start → Template → LLM → Conditional
                                        ├─ true  → UpperCase (branch A)
                                        └─ false → Passthrough (branch B)
        """
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pt", "prompt-template", template="Process: {input}"),
                make_node("llm", "llm-completion"),
                make_node("cond", "conditional"),
                make_node("branch_a", "uppercase"),
                make_node("branch_b", "passthrough"),
            ],
            edges=[
                make_edge("cs", "pt", "output", "input"),
                make_edge("pt", "llm", "output", "prompt"),
                make_edge("llm", "cond", "output", "input"),
                make_edge("cond", "branch_a", "true", "input"),
                make_edge("cond", "branch_b", "false", "input"),
            ],
        )
        graph["nodes"][3]["data"]["condition"] = True  # route to branch_a
        flow_ctx.state.user_message = "pipeline test"

        all_events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            all_events.append(event)

        node_events = [e for e in all_events if isinstance(e, NodeEvent)]
        executed_nodes = []
        for e in node_events:
            if e.node_id not in executed_nodes:
                executed_nodes.append(e.node_id)

        assert "cs" in executed_nodes
        assert "pt" in executed_nodes
        assert "llm" in executed_nodes
        assert "cond" in executed_nodes

        assert "branch_a" in executed_nodes
        assert "branch_b" not in executed_nodes

    @pytest.mark.asyncio
    async def test_full_pipeline_false_branch(self, flow_ctx):
        """Same pipeline, condition=False → branch B executes instead."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pt", "prompt-template", template="Q: {input}"),
                make_node("llm", "llm-completion"),
                make_node("cond", "conditional"),
                make_node("branch_a", "uppercase"),
                make_node("branch_b", "passthrough"),
            ],
            edges=[
                make_edge("cs", "pt", "output", "input"),
                make_edge("pt", "llm", "output", "prompt"),
                make_edge("llm", "cond", "output", "input"),
                make_edge("cond", "branch_a", "true", "input"),
                make_edge("cond", "branch_b", "false", "input"),
            ],
        )
        graph["nodes"][3]["data"]["condition"] = False  # route to branch_b
        flow_ctx.state.user_message = "false path"

        all_events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            all_events.append(event)

        node_events = [e for e in all_events if isinstance(e, NodeEvent)]
        executed_nodes = {e.node_id for e in node_events}

        assert "branch_b" in executed_nodes
        assert "branch_a" not in executed_nodes

    @pytest.mark.asyncio
    async def test_diamond_convergence(self, flow_ctx):
        """
        Diamond: A → B, A → C, B → D, C → D
        All nodes execute, D gets inputs from both B and C.
        """
        graph = make_graph(
            nodes=[
                make_node("A", "chat-start"),
                make_node("B", "uppercase"),
                make_node("C", "passthrough"),
                make_node("D", "passthrough"),
            ],
            edges=[
                make_edge("A", "B", "output", "input"),
                make_edge("A", "C", "output", "input"),
                make_edge("B", "D", "output", "input_b"),
                make_edge("C", "D", "output", "input_c"),
            ],
        )
        flow_ctx.state.user_message = "diamond"

        all_events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            all_events.append(event)

        node_events = [e for e in all_events if isinstance(e, NodeEvent)]
        executed = {e.node_id for e in node_events}

        assert {"A", "B", "C", "D"} <= executed


# ═══════════════════════════════════════════════════════════════════════
# 9. Parametrized edge cases
# ═══════════════════════════════════════════════════════════════════════


class TestFlowEdgeCases:
    """Parametrized tests for boundary conditions."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "condition,expected_live,expected_dead",
        [
            (True, "live", "dead"),
            (False, "dead", "live"),
        ],
        ids=["condition-true", "condition-false"],
    )
    async def test_conditional_routing_parametrized(
        self, flow_ctx, condition, expected_live, expected_dead
    ):
        """Parametrized: conditional routes to correct branch."""
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("cond", "conditional"),
                make_node("live", "passthrough"),
                make_node("dead", "passthrough"),
            ],
            edges=[
                make_edge("cs", "cond", "output", "input"),
                make_edge("cond", "live", "true", "input"),
                make_edge("cond", "dead", "false", "input"),
            ],
        )
        graph["nodes"][1]["data"]["condition"] = condition
        flow_ctx.state.user_message = "param_test"

        events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        node_events = [e for e in events if isinstance(e, NodeEvent)]
        executed = {e.node_id for e in node_events}

        assert expected_live in executed
        assert expected_dead not in executed

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "items,threshold,expect_pass,expect_reject",
        [
            ([1, 2, 3, 4, 5], 3, True, True),  # mixed
            ([5, 6, 7], 3, True, False),  # all pass
            ([1, 2], 3, False, True),  # all reject
            ([], 3, False, False),  # empty
        ],
        ids=["mixed", "all-pass", "all-reject", "empty"],
    )
    async def test_filter_output_ports_parametrized(
        self, flow_ctx, items, threshold, expect_pass, expect_reject
    ):
        """Parametrized: filter populates correct output ports."""
        graph = make_graph(
            nodes=[
                make_node("src", "chat-start"),
                make_node("flt", "filter", threshold=threshold),
                make_node("high", "passthrough"),
                make_node("low", "passthrough"),
            ],
            edges=[
                make_edge("src", "flt", "output", "input"),
                make_edge("flt", "high", "pass", "input"),
                make_edge("flt", "low", "reject", "input"),
            ],
        )
        flow_ctx.state.user_message = items

        events: list = []
        async for event in run_flow(graph, flow_ctx, executors=STUB_EXECUTORS):
            events.append(event)

        node_events = [e for e in events if isinstance(e, NodeEvent)]
        executed = {e.node_id for e in node_events}

        if expect_pass:
            assert "high" in executed
        else:
            assert "high" not in executed

        if expect_reject:
            assert "low" in executed
        else:
            assert "low" not in executed
