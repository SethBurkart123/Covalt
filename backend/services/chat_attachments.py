from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol, Sequence

from .. import db
from ..models.chat import Attachment
from .file_storage import get_extension_from_mime, get_pending_attachment_path
from .workspace_manager import get_workspace_manager

logger = logging.getLogger(__name__)


class AttachmentMetaLike(Protocol):
    id: str
    type: str
    name: str
    mimeType: str
    size: int


@dataclass
class StreamAttachmentState:
    attachments: list[Attachment]
    manifest_id: str | None
    file_renames: dict[str, str]


def _collect_pending_files(
    attachments: Sequence[AttachmentMetaLike],
) -> list[tuple[str, bytes]]:
    files_to_add: list[tuple[str, bytes]] = []
    for att in attachments:
        extension = get_extension_from_mime(att.mimeType)
        pending_path = get_pending_attachment_path(att.id, extension)
        if pending_path.exists():
            files_to_add.append((att.name, pending_path.read_bytes()))
            logger.info(f"[stream] Loaded pending file: {att.name}")
        else:
            logger.warning(
                f"[stream] Attachment {att.id} ({att.name}) not found in pending storage"
            )
    return files_to_add


def _get_parent_manifest_id(chat_id: str) -> str | None:
    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_msg_id = chat.active_leaf_message_id if chat else None
        if not parent_msg_id:
            return None
        return db.get_manifest_for_message(sess, parent_msg_id)


def _build_saved_attachments(
    attachments: Sequence[AttachmentMetaLike],
    file_renames: dict[str, str],
) -> list[Attachment]:
    return [
        Attachment(
            id=att.id,
            type=att.type,
            name=file_renames.get(att.name, att.name),
            mimeType=att.mimeType,
            size=att.size,
        )
        for att in attachments
    ]


def _cleanup_pending_files(attachments: Sequence[AttachmentMetaLike]) -> None:
    for att in attachments:
        extension = get_extension_from_mime(att.mimeType)
        pending_path = get_pending_attachment_path(att.id, extension)
        if pending_path.exists():
            pending_path.unlink()


def prepare_stream_attachments(
    chat_id: str,
    attachments: Sequence[AttachmentMetaLike],
    *,
    source_ref: str | None,
) -> StreamAttachmentState:
    if not attachments:
        return StreamAttachmentState(attachments=[], manifest_id=None, file_renames={})

    logger.info(
        f"[stream] Processing {len(attachments)} attachments for chat {chat_id}"
    )
    files_to_add = _collect_pending_files(attachments)
    if not files_to_add:
        return StreamAttachmentState(attachments=[], manifest_id=None, file_renames={})

    workspace_manager = get_workspace_manager(chat_id)
    manifest_id, file_renames = workspace_manager.add_files(
        files=files_to_add,
        parent_manifest_id=_get_parent_manifest_id(chat_id),
        source="user_upload",
        source_ref=source_ref,
    )

    _cleanup_pending_files(attachments)

    logger.info(
        f"[stream] Added {len(files_to_add)} files to workspace, {len(file_renames)} renamed"
    )
    return StreamAttachmentState(
        attachments=_build_saved_attachments(attachments, file_renames),
        manifest_id=manifest_id,
        file_renames=file_renames,
    )
