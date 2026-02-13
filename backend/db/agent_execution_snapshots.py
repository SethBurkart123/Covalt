from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from .models import AgentExecutionSnapshot


def save_agent_execution_snapshot(
    sess: Session,
    *,
    agent_id: str,
    snapshot: dict[str, Any],
) -> None:
    now = datetime.now(UTC).isoformat()
    payload = json.dumps(snapshot, default=str, separators=(",", ":"))

    row = sess.get(AgentExecutionSnapshot, agent_id)
    if row is None:
        row = AgentExecutionSnapshot(
            agent_id=agent_id,
            snapshot_json=payload,
            updated_at=now,
        )
        sess.add(row)
    else:
        row.snapshot_json = payload
        row.updated_at = now

    sess.commit()


def get_agent_execution_snapshot(
    sess: Session,
    *,
    agent_id: str,
) -> dict[str, Any] | None:
    row = sess.get(AgentExecutionSnapshot, agent_id)
    if row is None or not row.snapshot_json:
        return None

    try:
        parsed = json.loads(row.snapshot_json)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None

    return None
