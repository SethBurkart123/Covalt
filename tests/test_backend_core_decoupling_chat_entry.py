from __future__ import annotations

from typing import Any

import backend.services.chat_graph_config as chat_graph_config


def _graph(nodes: list[dict[str, Any]], edges: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"nodes": nodes, "edges": edges or []}


def test_build_entry_node_ids_uses_on_entry_resolve_hook_candidates(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    def fake_dispatch(hook_type, context: dict[str, Any]):
        calls.append({"hook_type": hook_type, "context": context})
        return [[{"node_type": "custom-entry"}]]

    monkeypatch.setattr(chat_graph_config, "dispatch_hook", fake_dispatch, raising=False)

    graph_data = _graph(
        nodes=[
            {"id": "chat", "type": "chat-start", "data": {}},
            {"id": "custom", "type": "custom-entry", "data": {}},
        ]
    )

    entry_ids = chat_graph_config._build_entry_node_ids(graph_data)

    assert entry_ids == ["custom"]
    assert calls, "onEntryResolve hook should be dispatched"
    assert calls[0]["context"]["mode"] == "chat"


def test_build_entry_node_ids_accepts_node_id_candidates_from_hook(monkeypatch) -> None:
    monkeypatch.setattr(
        chat_graph_config,
        "dispatch_hook",
        lambda *_args, **_kwargs: ["preferred-entry"],
        raising=False,
    )

    graph_data = _graph(
        nodes=[
            {"id": "preferred-entry", "type": "custom-source", "data": {}},
            {"id": "other", "type": "chat-start", "data": {}},
        ]
    )

    assert chat_graph_config._build_entry_node_ids(graph_data) == ["preferred-entry"]


def test_build_entry_node_ids_falls_back_to_chat_start_preference_when_hooks_return_no_candidates(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        chat_graph_config,
        "dispatch_hook",
        lambda *_args, **_kwargs: [],
        raising=False,
    )

    graph_data = _graph(
        nodes=[
            {"id": "chat", "type": "chat-start", "data": {}},
            {"id": "root", "type": "alpha", "data": {}},
            {"id": "child", "type": "beta", "data": {}},
        ],
        edges=[
            {
                "source": "root",
                "target": "child",
                "data": {"channel": "flow"},
            }
        ],
    )

    assert chat_graph_config._build_entry_node_ids(graph_data) == ["chat"]


def test_build_entry_node_ids_falls_back_to_roots_when_no_hook_candidates_and_no_chat_start(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        chat_graph_config,
        "dispatch_hook",
        lambda *_args, **_kwargs: [],
        raising=False,
    )

    graph_data = _graph(
        nodes=[
            {"id": "root", "type": "alpha", "data": {}},
            {"id": "child", "type": "beta", "data": {}},
        ],
        edges=[
            {
                "source": "root",
                "target": "child",
                "data": {"channel": "flow"},
            }
        ],
    )

    assert chat_graph_config._build_entry_node_ids(graph_data) == ["root"]
