from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .. import db

logger = logging.getLogger(__name__)


def _to_jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        try:
            return _to_jsonable(value.model_dump())
        except Exception:
            return str(value)

    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


@dataclass
class ExecutionTraceRecorder:
    kind: str
    chat_id: str | None
    message_id: str | None
    enabled: bool = True
    execution_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _events: list[dict[str, Any]] = field(default_factory=list)
    _seq: int = 0
    _root_run_id: str | None = None

    def start(self) -> None:
        if not self.enabled:
            return

        try:
            with db.db_session() as sess:
                db.create_execution_run(
                    sess,
                    id=self.execution_id,
                    chat_id=self.chat_id,
                    message_id=self.message_id,
                    kind=self.kind,
                    status="streaming",
                    root_run_id=None,
                )
        except Exception as exc:
            logger.warning("[execution_trace] Failed to create run: %s", exc)

    def set_root_run_id(self, run_id: str | None) -> None:
        if not run_id:
            return
        self._root_run_id = run_id

    def record(
        self,
        *,
        event_type: str,
        payload: Any = None,
        node_id: str | None = None,
        node_type: str | None = None,
        run_id: str | None = None,
    ) -> int:
        if not self.enabled:
            return 0

        self._seq += 1
        self._events.append(
            {
                "seq": self._seq,
                "ts": datetime.now(UTC).isoformat(),
                "event_type": event_type,
                "node_id": node_id,
                "node_type": node_type,
                "run_id": run_id,
                "payload": _to_jsonable(payload),
            }
        )
        return self._seq

    def finish(self, *, status: str, error_message: str | None = None) -> None:
        if not self.enabled:
            return

        try:
            with db.db_session() as sess:
                db.append_execution_events(
                    sess,
                    execution_id=self.execution_id,
                    events=self._events,
                )
                db.update_execution_run(
                    sess,
                    execution_id=self.execution_id,
                    status=status,
                    root_run_id=self._root_run_id,
                    error_message=error_message,
                    end_run=True,
                )
        except Exception as exc:
            logger.warning("[execution_trace] Failed to persist trace: %s", exc)
