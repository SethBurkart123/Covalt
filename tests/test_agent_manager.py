from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Iterator

import pytest

from backend.services.agent_manager import AgentManager
from backend.services.graph_normalizer import normalize_graph_edges


def test_normalize_graph_edges_requires_explicit_channel() -> None:
    nodes = [{"id": "a1", "type": "agent", "data": {}}]
    edges = [{"id": "e1", "source": "a1", "target": "a1", "data": {}}]

    with pytest.raises(ValueError, match="invalid channel"):
        normalize_graph_edges(nodes, edges)


def test_normalize_graph_edges_preserves_handles_and_data() -> None:
    nodes = [
        {"id": "a1", "type": "agent", "data": {}},
        {"id": "a2", "type": "agent", "data": {}},
    ]
    edges = [
        {
            "id": "e1",
            "source": "a1",
            "sourceHandle": "agent",
            "target": "a2",
            "targetHandle": "agent",
            "data": {
                "sourceType": "data",
                "targetType": "data",
                "channel": "flow",
                "custom": "kept",
            },
        }
    ]

    normalized = normalize_graph_edges(nodes, edges)

    assert normalized[0]["sourceHandle"] == "agent"
    assert normalized[0]["targetHandle"] == "agent"
    assert normalized[0]["data"]["channel"] == "flow"
    assert normalized[0]["data"]["custom"] == "kept"


def test_normalize_graph_edges_dedupes_exact_duplicates() -> None:
    nodes = [{"id": "a1", "type": "agent", "data": {}}]
    edges = [
        {
            "id": "e1",
            "source": "a1",
            "sourceHandle": "output",
            "target": "a1",
            "targetHandle": "input",
            "data": {"channel": "flow"},
        },
        {
            "id": "e2",
            "source": "a1",
            "sourceHandle": "output",
            "target": "a1",
            "targetHandle": "input",
            "data": {"channel": "flow"},
        },
    ]

    normalized = normalize_graph_edges(nodes, edges)

    assert len(normalized) == 1
    assert normalized[0]["id"] == "e1"


class _FakeQuery:
    def __init__(self, record: Any | None) -> None:
        self._record = record

    def filter(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def first(self) -> Any | None:
        return self._record


class _FakeSession:
    def __init__(self, record: Any | None) -> None:
        self._record = record

    def query(self, model: Any) -> _FakeQuery:
        return _FakeQuery(self._record)

    def commit(self) -> None:
        return None


@contextmanager
def _fake_db_session(record: Any | None) -> Iterator[_FakeSession]:
    yield _FakeSession(record)


def _make_manager(tmp_path: Any, monkeypatch: Any) -> AgentManager:
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        "backend.services.agent_manager.get_agents_directory", lambda: agents_dir
    )
    return AgentManager()


def test_agent_manager_save_graph_preserves_explicit_channel(
    tmp_path: Any, monkeypatch: Any
) -> None:
    manager = _make_manager(tmp_path, monkeypatch)
    record = SimpleNamespace(
        id="agent-1",
        name="Agent",
        description=None,
        icon=None,
        preview_image=None,
        graph_data="{}",
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
    )
    monkeypatch.setattr(
        "backend.services.agent_manager.db_session", lambda: _fake_db_session(record)
    )

    ok = manager.save_graph(
        "agent-1",
        nodes=[
            {"id": "cs", "type": "chat-start", "data": {}},
            {"id": "a1", "type": "agent", "data": {}},
        ],
        edges=[
            {
                "id": "e1",
                "source": "cs",
                "sourceHandle": "output",
                "target": "a1",
                "targetHandle": "input",
                "data": {"channel": "flow"},
            }
        ],
    )

    assert ok is True
    stored_graph = json.loads(record.graph_data)
    stored_edge = stored_graph["edges"][0]
    assert stored_edge["sourceHandle"] == "output"
    assert stored_edge["targetHandle"] == "input"
    assert stored_edge["data"]["channel"] == "flow"


def test_agent_manager_get_agent_requires_valid_channel(
    tmp_path: Any, monkeypatch: Any
) -> None:
    manager = _make_manager(tmp_path, monkeypatch)
    record = SimpleNamespace(
        id="agent-1",
        name="Agent",
        description=None,
        icon=None,
        preview_image=None,
        graph_data=json.dumps(
            {
                "nodes": [{"id": "a1", "type": "agent", "data": {}}],
                "edges": [
                    {
                        "id": "broken",
                        "source": "a1",
                        "sourceHandle": "output",
                        "target": "a1",
                        "targetHandle": "input",
                        "data": {},
                    }
                ],
            }
        ),
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
    )
    monkeypatch.setattr(
        "backend.services.agent_manager.db_session", lambda: _fake_db_session(record)
    )

    with pytest.raises(ValueError, match="invalid channel"):
        manager.get_agent("agent-1")
