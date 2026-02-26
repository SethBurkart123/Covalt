"""Shared conversation run helpers for streaming and branch commands.

Extracts duplicated patterns from commands/streaming.py and commands/branches.py
into small, composable building blocks.
"""

from __future__ import annotations

import json
import logging
import traceback
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

from zynk import Channel

from .. import db
from ..models.chat import Attachment, ChatMessage
from ..services.runtime_events import (
    EVENT_ASSISTANT_MESSAGE_ID,
    EVENT_RUN_ERROR,
    EVENT_RUN_STARTED,
    emit_chat_event,
)
from ..services.chat_graph_runner import (
    append_error_block_to_message,
    extract_error_message,
)
from ..services.option_validation import (
    ModelResolutionError,
    resolve_and_validate_model_options,
)
from ..services import stream_broadcaster as broadcaster

logger = logging.getLogger(__name__)


def validate_model_options(
    chat_id: Optional[str],
    model_id: Optional[str],
    model_options: Optional[Dict[str, Any]],
    channel: Channel,
) -> Optional[Dict[str, Any]]:
    """Resolve and validate model options, sending RunError on failure.

    Returns the validated dict, or None if validation failed (error already sent).
    """
    try:
        return resolve_and_validate_model_options(chat_id, model_id, model_options)
    except (ModelResolutionError, ValueError) as exc:
        emit_chat_event(channel, EVENT_RUN_ERROR, content=str(exc))
        return None


def build_message_history(db_messages: List[Any]) -> List[ChatMessage]:
    """Convert a list of DB Message objects into ChatMessages."""
    result: List[ChatMessage] = []

    for m in db_messages:
        content = m.content
        if isinstance(content, str) and content.strip().startswith("["):
            try:
                content = json.loads(content)
            except Exception:
                pass

        attachments = None
        if m.role == "user" and m.attachments:
            try:
                attachments_data = json.loads(m.attachments)
                attachments = [
                    Attachment(**att_data) for att_data in attachments_data
                ]
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

        result.append(
            ChatMessage(
                id=m.id,
                role=m.role,
                content=content,
                createdAt=m.createdAt,
                attachments=attachments,
            )
        )

    return result


def emit_run_start_events(
    channel: Channel,
    chat_id: Optional[str],
    assistant_msg_id: str,
    *,
    file_renames: Optional[Dict[str, str]] = None,
    blocks: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Send the RunStarted + AssistantMessageId event pair."""
    emit_chat_event(
        channel,
        EVENT_RUN_STARTED,
        sessionId=chat_id or None,
        fileRenames=file_renames,
    )
    emit_chat_event(
        channel,
        EVENT_ASSISTANT_MESSAGE_ID,
        content=assistant_msg_id,
        blocks=blocks,
    )


def _save_msg_content(msg_id: str, content: str) -> None:
    with db.db_session() as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


async def handle_streaming_run_error(
    assistant_msg_id: str,
    error: Exception,
    channel: Channel,
    *,
    chat_id: str = "",
    ephemeral: bool = False,
    label: str = "",
) -> None:
    """Handle runtime errors for streaming commands.

    Covers broadcaster status, error block persistence with fallback,
    and RunError event emission.
    """
    error_message = extract_error_message(str(error))
    logger.error(f"{label} Error: {error}")

    if chat_id:
        await broadcaster.update_stream_status(chat_id, "error", error_message)
        await broadcaster.unregister_stream(chat_id)

    if not ephemeral:
        try:
            append_error_block_to_message(
                assistant_msg_id,
                error_message=error_message,
                traceback_text=traceback.format_exc(),
            )
        except Exception as e2:
            logger.error(f"{label} Failed to append error block: {e2}")
            _save_msg_content(
                assistant_msg_id,
                json.dumps(
                    [
                        {
                            "type": "error",
                            "content": error_message,
                            "traceback": traceback.format_exc(),
                            "timestamp": datetime.now(UTC).isoformat(),
                        }
                    ]
                ),
            )

    emit_chat_event(channel, EVENT_RUN_ERROR, content=error_message)
