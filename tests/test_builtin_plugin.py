from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.services.plugins.plugin_registry import PluginRegistry
from nodes import get_executor
from nodes._types import DataValue, FlowContext, HookType, NodeEvent
from nodes.plugin import BUILTIN_EXECUTORS, register_builtin_plugin

REQUIRED_BUILTIN_NODE_TYPES = {
    "chat-start",
    "webhook-trigger",
    "webhook-end",
    "agent",
    "conditional",
    "merge",
    "reroute",
}


def test_builtin_plugin_is_loaded_in_default_registry() -> None:
    for node_type in REQUIRED_BUILTIN_NODE_TYPES:
        assert get_executor(node_type) is BUILTIN_EXECUTORS[node_type]


def test_register_builtin_plugin_registers_required_backend_hooks() -> None:
    registry = PluginRegistry()
    register_builtin_plugin(registry)

    assert registry.dispatch_hook(HookType.ON_ENTRY_RESOLVE, {"mode": "chat"}) == [
        "chat-start"
    ]
    assert registry.dispatch_hook(HookType.ON_ENTRY_RESOLVE, {"mode": "flow"}) == []

    assert registry.dispatch_hook(
        HookType.ON_ROUTE_EXTRACT,
        {
            "node_type": "webhook-trigger",
            "data": {"hookId": "hook_123"},
        },
    ) == ["hook_123"]
    assert registry.dispatch_hook(
        HookType.ON_ROUTE_EXTRACT,
        {
            "node_type": "other",
            "data": {"hookId": "hook_999"},
        },
    ) == []

    event = NodeEvent(
        node_id="n1",
        node_type="webhook-end",
        event_type="result",
        run_id="run-1",
        data={
            "outputs": {
                "response": {
                    "type": "data",
                    "value": {
                        "status": 201,
                        "headers": {"x-test": "1"},
                        "body": {"ok": True},
                    },
                }
            }
        },
    )

    assert registry.dispatch_hook(
        HookType.ON_RESPONSE_EXTRACT,
        {
            "node_type": "webhook-end",
            "event": event,
        },
    ) == [
        {
            "status": 201,
            "headers": {"x-test": "1"},
            "body": {"ok": True},
        }
    ]


@pytest.mark.asyncio
async def test_conditional_merge_and_reroute_executors_are_available_via_registry() -> None:
    conditional = get_executor("conditional")
    merge = get_executor("merge")
    reroute = get_executor("reroute")

    assert conditional is not None
    assert merge is not None
    assert reroute is not None

    condition_result = await conditional.execute(
        {"field": "status", "operator": "notEquals", "value": "active"},
        {"input": DataValue(type="data", value={"status": "inactive"})},
        FlowContext(
            node_id="conditional-1",
            chat_id=None,
            run_id="run-1",
            state=SimpleNamespace(),
            runtime=None,
            services=SimpleNamespace(),
        ),
    )
    assert set(condition_result.outputs.keys()) == {"true"}

    merge_result = await merge.execute(
        {},
        {
            "input_2": DataValue(type="data", value="second"),
            "input": DataValue(type="data", value="first"),
        },
        FlowContext(
            node_id="merge-1",
            chat_id=None,
            run_id="run-1",
            state=SimpleNamespace(),
            runtime=None,
            services=SimpleNamespace(),
        ),
    )
    assert merge_result.outputs["output"].value == ["first", "second"]

    reroute_result = await reroute.execute(
        {"_socketType": "model", "value": "openai:gpt-4o"},
        {},
        FlowContext(
            node_id="reroute-1",
            chat_id=None,
            run_id="run-1",
            state=SimpleNamespace(),
            runtime=None,
            services=SimpleNamespace(),
        ),
    )
    assert reroute_result.outputs["output"].type == "model"
    assert reroute_result.outputs["output"].value == "openai:gpt-4o"


@pytest.mark.asyncio
async def test_reroute_materialize_supports_flow_and_link_channels_with_default_fallback() -> None:
    reroute = get_executor("reroute")
    assert reroute is not None

    runtime = MagicMock()
    runtime.incoming_edges.side_effect = [
        [],
        [
            {"source": "tool-1", "sourceHandle": "output"},
            {"source": "tool-2", "sourceHandle": "output"},
        ],
    ]
    runtime.materialize_output = AsyncMock(side_effect=[["a"], "b"])

    link_only_context = FlowContext(
        node_id="reroute-1",
        chat_id=None,
        run_id="run-1",
        state=SimpleNamespace(),
        runtime=runtime,
        services=SimpleNamespace(),
    )

    link_result = await reroute.materialize({"value": "fallback"}, "output", link_only_context)
    assert link_result == ["a", "b"]

    runtime.incoming_edges.side_effect = [[], []]
    runtime.materialize_output = AsyncMock(return_value=None)
    fallback_result = await reroute.materialize(
        {"_socketType": "json", "value": {"fallback": True}},
        "output",
        link_only_context,
    )
    assert fallback_result == {"fallback": True}
