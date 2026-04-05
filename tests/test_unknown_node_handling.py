from __future__ import annotations

import pytest

from backend.models.chat import ChatMessage
from backend.services.streaming.chat_stream import handle_flow_stream
from backend.services.flows.flow_executor import run_flow
from backend.services.flows.graph_normalizer import normalize_graph_data
from tests.conftest import CapturingChannel, make_edge, make_graph, make_node


@pytest.mark.asyncio
async def test_run_flow_raises_clear_error_for_unknown_node_types() -> None:
    graph = make_graph(
        nodes=[
            make_node("entry", "chat-start"),
            make_node("missing", "external.alpha:missing"),
        ],
        edges=[make_edge("entry", "missing", "output", "input")],
    )

    context = type(
        "Ctx",
        (),
        {
            "run_id": "run-1",
            "chat_id": None,
            "state": type("State", (), {"user_message": "hello"})(),
            "services": type("Services", (), {})(),
        },
    )()

    with pytest.raises(ValueError, match=r"unknown node type\(s\)"):
        async for _ in run_flow(graph, context):
            pass


@pytest.mark.asyncio
async def test_handle_flow_stream_surfaces_unknown_node_error() -> None:
    graph = normalize_graph_data(
        nodes=[
            {
                "id": "entry",
                "type": "chat_start",
                "position": {"x": 0, "y": 0},
                "data": {},
            },
            {
                "id": "missing",
                "type": "external.alpha:missing",
                "position": {"x": 200, "y": 0},
                "data": {},
            },
        ],
        edges=[
            {
                "id": "e1",
                "source": "entry",
                "sourceHandle": "output",
                "target": "missing",
                "targetHandle": "input",
                "data": {"channel": "flow"},
            }
        ],
    )

    channel = CapturingChannel()
    await handle_flow_stream(
        graph,
        None,
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-unknown",
        channel,
        ephemeral=True,
    )

    event_names = [event.get("event") for event in channel.events]
    assert event_names.count("RunError") == 1
    assert "RunCompleted" not in event_names
    run_error = next(event for event in channel.events if event.get("event") == "RunError")
    assert "unknown node type" in str(run_error.get("content", "")).lower()
