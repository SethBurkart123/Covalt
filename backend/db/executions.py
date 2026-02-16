from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ExecutionEvent, ExecutionRun


def create_execution_run(
    sess: Session,
    *,
    id: str,
    chat_id: Optional[str],
    message_id: Optional[str],
    kind: str,
    status: str,
    root_run_id: Optional[str],
) -> None:
    now = datetime.now(UTC).isoformat()
    sess.add(
        ExecutionRun(
            id=id,
            chat_id=chat_id,
            message_id=message_id,
            kind=kind,
            status=status,
            root_run_id=root_run_id,
            started_at=now,
            updated_at=now,
        )
    )
    sess.commit()


def update_execution_run(
    sess: Session,
    *,
    execution_id: str,
    status: Optional[str] = None,
    root_run_id: Optional[str] = None,
    error_message: Optional[str] = None,
    end_run: bool = False,
) -> None:
    run = sess.get(ExecutionRun, execution_id)
    if run is None:
        return

    if status is not None:
        run.status = status
    if root_run_id is not None:
        run.root_run_id = root_run_id
    run.error_message = error_message

    now = datetime.now(UTC).isoformat()
    run.updated_at = now
    if end_run:
        run.ended_at = now

    sess.commit()


def append_execution_events(
    sess: Session,
    *,
    execution_id: str,
    events: list[dict[str, Any]],
) -> None:
    if not events:
        return

    rows: list[ExecutionEvent] = []
    for event in events:
        payload = event.get("payload")
        rows.append(
            ExecutionEvent(
                execution_id=execution_id,
                seq=int(event["seq"]),
                ts=str(event["ts"]),
                event_type=str(event["event_type"]),
                node_id=(
                    str(event["node_id"]) if event.get("node_id") is not None else None
                ),
                node_type=(
                    str(event["node_type"])
                    if event.get("node_type") is not None
                    else None
                ),
                run_id=(
                    str(event["run_id"]) if event.get("run_id") is not None else None
                ),
                payload_json=(
                    json.dumps(payload, separators=(",", ":"))
                    if payload is not None
                    else None
                ),
            )
        )

    sess.add_all(rows)
    sess.commit()


def get_latest_execution_run_for_message(
    sess: Session,
    *,
    message_id: str,
) -> ExecutionRun | None:
    stmt = (
        select(ExecutionRun)
        .where(ExecutionRun.message_id == message_id)
        .order_by(ExecutionRun.started_at.desc())
        .limit(1)
    )
    return sess.scalar(stmt)


def get_execution_events(
    sess: Session,
    *,
    execution_id: str,
) -> list[dict[str, Any]]:
    stmt = (
        select(ExecutionEvent)
        .where(ExecutionEvent.execution_id == execution_id)
        .order_by(ExecutionEvent.seq.asc())
    )
    rows = list(sess.scalars(stmt))

    result: list[dict[str, Any]] = []
    for row in rows:
        payload: Any = None
        if row.payload_json:
            try:
                payload = json.loads(row.payload_json)
            except Exception:
                payload = row.payload_json

        result.append(
            {
                "seq": row.seq,
                "ts": row.ts,
                "eventType": row.event_type,
                "nodeId": row.node_id,
                "nodeType": row.node_type,
                "runId": row.run_id,
                "payload": payload,
            }
        )

    return result
