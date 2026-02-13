from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .execution_trace import _to_jsonable

from .. import db


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


@dataclass
class AgentExecutionSnapshotRecorder:
    agent_id: str
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    updated_at_ms: int | None = None

    def record_node_event(
        self,
        *,
        event_type: str,
        node_id: str,
        node_type: str | None,
        payload: dict[str, Any] | None,
    ) -> None:
        if not node_id:
            return

        now_ms = _now_ms()
        self.updated_at_ms = now_ms
        previous = self.nodes.get(node_id, {})

        status = previous.get("status", "idle")
        outputs = previous.get("outputs")
        error = previous.get("error")

        if event_type == "started":
            status = "running"
        elif event_type == "completed":
            status = "completed"
        elif event_type == "error":
            status = "error"
            if isinstance(payload, dict):
                error_value = payload.get("error")
                if error_value is not None:
                    error = str(error_value)
        elif event_type == "result":
            if isinstance(payload, dict):
                outputs_value = payload.get("outputs")
                if isinstance(outputs_value, dict):
                    outputs = _to_jsonable(outputs_value)

        snapshot: dict[str, Any] = {
            "nodeId": node_id,
            "status": status,
            "updatedAt": now_ms,
        }
        node_type_value = node_type or previous.get("nodeType")
        if node_type_value is not None:
            snapshot["nodeType"] = node_type_value
        if outputs is not None:
            snapshot["outputs"] = outputs
        if error is not None:
            snapshot["error"] = error

        self.nodes[node_id] = snapshot

    def persist(self) -> None:
        if not self.nodes:
            return

        payload = {
            "updatedAt": self.updated_at_ms or _now_ms(),
            "nodes": self.nodes,
        }

        with db.db_session() as sess:
            db.save_agent_execution_snapshot(
                sess,
                agent_id=self.agent_id,
                snapshot=payload,
            )
