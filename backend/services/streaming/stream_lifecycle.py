from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from ... import db
from ...models import parse_message_blocks, serialize_message_blocks
from ...models.chat import ChatEvent
from . import stream_broadcaster as broadcaster

logger = logging.getLogger(__name__)


class BroadcastingChannel:
    def __init__(self, channel: Any, chat_id: str):
        self._channel = channel
        self._chat_id = chat_id
        self._pending_broadcasts: list[asyncio.Task[Any]] = []
        self._broadcast_tail: asyncio.Task[Any] | None = None

    def send_model(self, event: ChatEvent) -> None:
        self._channel.send_model(event)

        if self._chat_id:
            event_dict = event.model_dump() if hasattr(event, "model_dump") else event.dict()
            previous = self._broadcast_tail

            async def _broadcast_in_order() -> None:
                if previous is not None:
                    await previous
                await broadcaster.broadcast_event(self._chat_id, event_dict)

            task = asyncio.create_task(_broadcast_in_order())
            self._broadcast_tail = task
            self._pending_broadcasts.append(task)

    async def flush_broadcasts(self) -> None:
        if self._pending_broadcasts:
            await asyncio.gather(*self._pending_broadcasts, return_exceptions=True)
            self._pending_broadcasts.clear()
            self._broadcast_tail = None


def save_msg_content(msg_id: str, content: str) -> None:
    with db.db_session() as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


def load_initial_content(msg_id: str) -> list[dict[str, Any]]:
    try:
        with db.db_session() as sess:
            message = sess.get(db.Message, msg_id)
            if not message or not message.content:
                return []

            return parse_message_blocks(
                message.content,
                strip_trailing_errors=True,
            )
    except Exception as exc:
        logger.info("[flow_stream] Warning loading initial content: %s", exc)
        return []


def append_error_block_to_message(
    message_id: str,
    *,
    error_message: str,
    traceback_text: str | None = None,
) -> None:
    error_block: dict[str, Any] = {
        "type": "error",
        "content": error_message,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    if traceback_text:
        error_block["traceback"] = traceback_text

    with db.db_session() as sess:
        message = sess.get(db.Message, message_id)
        blocks = (
            parse_message_blocks(message.content)
            if message and isinstance(message.content, str)
            else []
        )
        blocks.append(error_block)
        db.update_message_content(
            sess,
            messageId=message_id,
            content=serialize_message_blocks(blocks),
        )


def _log_token_usage(
    *,
    run_id: str | None,
    model: str | None,
    provider: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
    cache_read_tokens: int | None,
    cache_write_tokens: int | None,
    reasoning_tokens: int | None,
    time_to_first_token: float | None,
) -> None:
    if (
        input_tokens is None
        and output_tokens is None
        and total_tokens is None
        and cache_read_tokens is None
        and cache_write_tokens is None
        and reasoning_tokens is None
    ):
        return

    tokens = {
        "input": input_tokens,
        "output": output_tokens,
        "total": total_tokens,
        "cache_read": cache_read_tokens,
        "cache_write": cache_write_tokens,
        "reasoning": reasoning_tokens,
    }
    tokens_str = ", ".join(
        f"{key}={value}" for key, value in tokens.items() if value is not None
    )
    ttf_str = f" ttf={time_to_first_token:.3f}s" if time_to_first_token else ""
    logger.info(
        "[usage] run_id=%s provider=%s model=%s %s%s",
        run_id or "-",
        provider or "-",
        model or "-",
        tokens_str,
        ttf_str,
    )
