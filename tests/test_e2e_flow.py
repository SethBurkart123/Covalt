"""End-to-end flow execution tests.

Exercises a comprehensive workflow through the real flow executor with
fake models and stub executors. No network calls, no real LLM APIs —
but the full engine runs: topological sort, data routing, expression
resolution, type coercion, dead branch detection, streaming events.

The test graph:

  Model Selector ──[model]──┐
                             │
  Chat Start ──[string]──→ Passthrough ──[string]──→ LLM Completion ──[string]──→ Conditional
                                                          ↑ model                       ├─ true → UpperCase
                                                                                        └─ false → (dead)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from backend.services.flows.flow_executor import (
    _flow_edges,
    find_flow_nodes,
    run_flow,
    topological_sort,
)
from nodes import _expressions
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from tests.conftest import make_edge, make_graph, make_node


class ChatStartStub:
    node_type = "chat-start"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        msg = getattr(context.state, "user_message", "hello")
        return ExecutionResult(outputs={"output": DataValue("data", {"message": msg})})


class ModelSelectorStub:
    node_type = "model-selector"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        model = inputs.get("model", DataValue("model", "")).value or data.get(
            "model", ""
        )
        return ExecutionResult(outputs={"output": DataValue("model", model)})


class LLMCompletionStub:
    node_type = "llm-completion"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ):
        prompt_val = inputs.get("prompt", DataValue("string", "")).value or data.get(
            "prompt", ""
        )
        if isinstance(prompt_val, dict):
            prompt = (
                prompt_val.get("text") or prompt_val.get("message") or str(prompt_val)
            )
        else:
            prompt = str(prompt_val) if prompt_val else ""
        model = inputs.get("model", DataValue("model", "")).value or data.get(
            "model", "unknown"
        )

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"model": model},
        )

        response = f"[{model}] {prompt}"

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="progress",
            run_id=context.run_id,
            data={"token": response},
        )
        yield ExecutionResult(outputs={"output": DataValue("data", {"text": response})})


class ConditionalStub:
    node_type = "conditional"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        field = data.get("field", "")
        operator = data.get("operator", "contains")
        compare_val = data.get("value", "")

        input_data = inputs.get("input", DataValue("data", {}))
        value = input_data.value

        if isinstance(value, dict) and field:
            field_val = value.get(field)
        elif isinstance(value, dict) and not field:
            field_val = str(value)
        elif isinstance(value, str) and not field:
            field_val = value
        else:
            field_val = value

        if operator == "contains":
            condition_met = compare_val in str(field_val) if field_val else False
        elif operator == "equals":
            condition_met = field_val == compare_val
        else:
            condition_met = bool(field_val)

        if condition_met:
            return ExecutionResult(outputs={"true": input_data})
        return ExecutionResult(outputs={"false": input_data})


class UpperCaseStub:
    node_type = "uppercase"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        text = inputs.get("input", DataValue("data", {})).value
        if isinstance(text, dict):
            text = text.get("text", text.get("message", str(text)))
        return ExecutionResult(
            outputs={"output": DataValue("data", {"text": str(text).upper()})}
        )


class PassthroughStub:
    node_type = "passthrough"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        return ExecutionResult(
            outputs={"output": inputs.get("input", DataValue("string", ""))}
        )


class DataEchoStub:
    node_type = "data-echo"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        del inputs, context
        return ExecutionResult(
            outputs={"output": DataValue("data", {"payload": data.get("payload")})}
        )


STUBS = {
    cls.node_type: cls()
    for cls in [
        ChatStartStub,
        ModelSelectorStub,
        LLMCompletionStub,
        ConditionalStub,
        UpperCaseStub,
        PassthroughStub,
        DataEchoStub,
    ]
}


def _flow_ctx(user_message: str = "hello") -> Any:
    state = MagicMock()
    state.user_message = user_message
    ctx = MagicMock()
    ctx.run_id = "test-run"
    ctx.chat_id = "test-chat"
    ctx.state = state
    ctx.tool_registry = MagicMock()
    return ctx



class TestE2EFullPipeline:
    """Full pipeline graph with model fanout, LLM completion, and conditional routing."""

    def _build_graph(self):
        return make_graph(
            nodes=[
                make_node("model", "model-selector", model="mock:gpt-test"),
                make_node("cs", "chat-start"),
                make_node("pipe", "passthrough"),
                make_node("llm", "llm-completion"),
                make_node(
                    "cond",
                    "conditional",
                    field="",
                    operator="contains",
                    value="mock:gpt-test",
                ),
                make_node("upper", "uppercase"),
                make_node("dead", "passthrough"),
            ],
            edges=[
                make_edge("model", "llm", "output", "model"),
                make_edge("cs", "pipe", "output", "input"),
                make_edge("pipe", "llm", "output", "prompt"),
                make_edge("llm", "cond", "output", "input"),
                make_edge("cond", "upper", "true", "input"),
                make_edge("cond", "dead", "false", "input"),
            ],
        )

    @pytest.mark.asyncio
    async def test_full_pipeline_executes_correct_branch(self):
        graph = self._build_graph()
        ctx = _flow_ctx("Hello world")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)

        llm_started = [
            e for e in events if e.node_id == "llm" and e.event_type == "started"
        ]
        assert len(llm_started) == 1
        assert llm_started[0].data is not None
        assert llm_started[0].data["model"] == "mock:gpt-test"

        dead_events = [e for e in events if e.node_id == "dead"]
        assert dead_events == [], "Dead branch should not execute"

    @pytest.mark.asyncio
    async def test_pipeline_data_flows_correctly(self):
        graph = self._build_graph()
        ctx = _flow_ctx("test input")

        all_results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, ExecutionResult):
                all_results.append(item)

        assert len(all_results) >= 5

        last = all_results[-1]
        output = last.outputs.get("output")
        assert output is not None
        assert output.type == "data"
        assert "MOCK:GPT-TEST" in output.value["text"]
        assert "TEST INPUT" in output.value["text"]

    @pytest.mark.asyncio
    async def test_model_selector_fans_out(self):
        graph = self._build_graph()
        ctx = _flow_ctx("fan out test")

        llm_model_data = None
        async for item in run_flow(graph, ctx, executors=STUBS):
            if (
                isinstance(item, NodeEvent)
                and item.node_id == "llm"
                and item.event_type == "started"
            ):
                llm_model_data = item.data

        assert llm_model_data is not None
        assert llm_model_data["model"] == "mock:gpt-test"

    @pytest.mark.asyncio
    async def test_false_branch_when_condition_fails(self):
        graph = self._build_graph()
        graph["nodes"][4]["data"]["value"] = "NONEXISTENT_STRING"
        ctx = _flow_ctx("test")

        events: list[NodeEvent] = []
        results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)
            elif isinstance(item, ExecutionResult):
                results.append(item)

        upper_events = [e for e in events if e.node_id == "upper"]
        assert upper_events == [], (
            "UpperCase should not execute when condition is false"
        )

        dead_events = [e for e in events if e.node_id == "dead"]
        assert len(dead_events) > 0, "Passthrough (false branch) should execute"



@pytest.mark.skipif(_expressions.quickjs is None, reason="quickjs is not installed")
class TestE2EExpressions:
    @pytest.mark.asyncio
    async def test_expression_resolves_from_general_input(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node(
                    "echo",
                    "data-echo",
                    payload="Write about {{ input.message }}",
                ),
            ],
            edges=[
                make_edge("cs", "echo", "output", "input"),
            ],
        )
        ctx = _flow_ctx("quantum physics")

        results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, ExecutionResult):
                results.append(item)

        payload = results[-1].outputs["output"].value["payload"]
        assert payload == "Write about quantum physics"

    @pytest.mark.asyncio
    async def test_node_id_expression_reference_is_supported(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node(
                    "echo1",
                    "data-echo",
                    payload="Echo {{ input.message }}",
                    _label="Friendly Echo",
                ),
                make_node(
                    "echo2",
                    "data-echo",
                    payload="From first: {{ $('echo1').item.json.payload }}",
                ),
            ],
            edges=[
                make_edge("cs", "echo1", "output", "input"),
                make_edge("echo1", "echo2", "output", "input"),
            ],
        )
        ctx = _flow_ctx("hello")

        results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, ExecutionResult):
                results.append(item)

        assert (
            results[-1].outputs["output"].value["payload"] == "From first: Echo hello"
        )

    @pytest.mark.asyncio
    async def test_full_expression_returns_object(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("echo", "data-echo", payload="{{ input }}"),
            ],
            edges=[
                make_edge("cs", "echo", "output", "input"),
            ],
        )
        ctx = _flow_ctx("hello")

        results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, ExecutionResult):
                results.append(item)

        payload = results[-1].outputs["output"].value["payload"]
        assert isinstance(payload, dict)
        assert payload.get("message") == "hello"

    @pytest.mark.asyncio
    async def test_js_expression_supports_methods(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("echo", "data-echo", payload="{{ input.message.split(' ')[0] }}"),
            ],
            edges=[
                make_edge("cs", "echo", "output", "input"),
            ],
        )
        ctx = _flow_ctx("hello world")

        results: list[ExecutionResult] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, ExecutionResult):
                results.append(item)

        payload = results[-1].outputs["output"].value["payload"]
        assert payload == "hello"



class TestE2EEdgeFiltering:
    def test_structural_edges_filtered(self):
        edges = [
            make_edge("agent1", "agent2", "output", "tools"),
            make_edge("mcp", "agent", "tools", "tools"),
            make_edge("cs", "pipe", "output", "input"),
            make_edge("pipe", "llm", "output", "prompt"),
        ]
        flow = _flow_edges(edges)
        assert len(flow) == 2
        assert all((e.get("data") or {}).get("channel") == "flow" for e in flow)

    def test_mixed_graph_partitions_correctly(self):
        class StructuralOnly:
            node_type = "structural-only"

            def build(self, data, context):
                return None

        nodes = [
            make_node("cs", "chat-start"),
            make_node("mcp", "structural-only"),
            make_node("llm", "llm-completion"),
        ]
        executors = {**STUBS, "structural-only": StructuralOnly()}
        flow = find_flow_nodes(nodes, executors)
        flow_ids = {n["id"] for n in flow}

        assert "cs" in flow_ids
        assert "llm" in flow_ids
        assert "mcp" not in flow_ids


class TestE2EDisconnectedComponents:
    @pytest.mark.asyncio
    async def test_disconnected_flow_component_executes(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pipe", "passthrough"),
                make_node("orphan", "passthrough"),
            ],
            edges=[
                make_edge("cs", "pipe", "output", "input"),
            ],
        )
        ctx = _flow_ctx("hello")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)

        started_nodes = {e.node_id for e in events if e.event_type == "started"}
        assert "cs" in started_nodes
        assert "pipe" in started_nodes
        assert "orphan" in started_nodes



class TestE2ETopologicalSort:
    def test_complex_graph_ordering(self):
        nodes = [
            make_node("model", "model-selector"),
            make_node("cs", "chat-start"),
            make_node("pipe", "passthrough"),
            make_node("llm", "llm-completion"),
            make_node("cond", "conditional"),
            make_node("upper", "uppercase"),
        ]
        edges = [
            make_edge("model", "llm", "output", "model"),
            make_edge("cs", "pipe", "output", "input"),
            make_edge("pipe", "llm", "output", "prompt"),
            make_edge("llm", "cond", "output", "input"),
            make_edge("cond", "upper", "true", "input"),
        ]
        order = topological_sort(nodes, edges)

        assert order.index("model") < order.index("llm")
        assert order.index("cs") < order.index("pipe")
        assert order.index("pipe") < order.index("llm")
        assert order.index("llm") < order.index("cond")
        assert order.index("cond") < order.index("upper")



class TestE2EEventProtocol:
    @pytest.mark.asyncio
    async def test_streaming_executor_emits_custom_events(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("llm", "llm-completion", model="mock:test"),
            ],
            edges=[make_edge("cs", "llm", "output", "prompt")],
        )
        ctx = _flow_ctx("stream test")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)

        llm_events = [e for e in events if e.node_id == "llm"]
        types = [e.event_type for e in llm_events]
        assert "started" in types
        assert "progress" in types

    @pytest.mark.asyncio
    async def test_sync_executor_gets_auto_events(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pipe", "passthrough"),
            ],
            edges=[make_edge("cs", "pipe", "output", "input")],
        )
        ctx = _flow_ctx("auto events")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)

        cs_events = [e for e in events if e.node_id == "cs"]
        cs_types = [e.event_type for e in cs_events]
        assert "started" in cs_types
        assert "completed" in cs_types

    @pytest.mark.asyncio
    async def test_event_ordering_respects_topology(self):
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("pipe", "passthrough"),
                make_node("llm", "llm-completion", model="mock:test"),
            ],
            edges=[
                make_edge("cs", "pipe", "output", "input"),
                make_edge("pipe", "llm", "output", "prompt"),
            ],
        )
        ctx = _flow_ctx("order test")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=STUBS):
            if isinstance(item, NodeEvent):
                events.append(item)

        first_occurrence: dict[str, int] = {}
        for i, e in enumerate(events):
            if e.node_id not in first_occurrence:
                first_occurrence[e.node_id] = i

        assert first_occurrence.get("cs", 0) < first_occurrence.get("pipe", 999)
        assert first_occurrence.get("pipe", 0) < first_occurrence.get("llm", 999)



class ExplodingStub:
    node_type = "exploding"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        raise RuntimeError("boom")


class TestE2EErrorHandling:
    @pytest.mark.asyncio
    async def test_error_stops_pipeline(self):
        stubs = {**STUBS, "exploding": ExplodingStub()}
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
        ctx = _flow_ctx("error test")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=stubs):
            if isinstance(item, NodeEvent):
                events.append(item)

        error_events = [e for e in events if e.event_type == "error"]
        assert len(error_events) >= 1
        assert error_events[0].node_id == "boom"

        after_events = [e for e in events if e.node_id == "after"]
        assert after_events == [], "Downstream should not execute after error"

    @pytest.mark.asyncio
    async def test_continue_on_fail(self):
        stubs = {**STUBS, "exploding": ExplodingStub()}
        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("boom", "exploding", on_error="continue"),
                make_node("after", "passthrough"),
            ],
            edges=[
                make_edge("cs", "boom", "output", "input"),
                make_edge("boom", "after", "output", "input"),
            ],
        )
        ctx = _flow_ctx("continue test")

        events: list[NodeEvent] = []
        async for item in run_flow(graph, ctx, executors=stubs):
            if isinstance(item, NodeEvent):
                events.append(item)

        after_events = [e for e in events if e.node_id == "after"]
        assert len(after_events) > 0, "Downstream should execute in continue-on-fail"
