"""
Upload commands for file attachments.

Provides immediate file upload with progress tracking using zynk's @upload decorator.
Files are stored in pending storage until linked to a chat.
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from ..services.file_storage import (
    cleanup_pending_uploads,
    delete_pending_attachment,
    get_extension_from_mime,
    get_media_type,
    move_pending_to_chat,
    save_pending_attachment,
)

logger = logging.getLogger(__name__)


class UploadAttachmentResult(BaseModel):
    """Result of uploading an attachment."""

    id: str
    type: str  # "image" | "file" | "audio" | "video"
    name: str
    mimeType: str
    size: int


class LinkAttachmentInfo(BaseModel):
    """Info needed to link an attachment to a chat."""

    id: str
    mimeType: str


class LinkAttachmentsRequest(BaseModel):
    """Request to link pending attachments to a chat."""

    chatId: str
    attachments: list[LinkAttachmentInfo]


class LinkAttachmentsResponse(BaseModel):
    """Response from linking attachments."""

    linked: list[str]
    errors: list[dict]


class DeletePendingRequest(BaseModel):
    """Request to delete a pending attachment."""

    id: str
    mimeType: str


# 50MB max file size (upload safety cap; Agno attachment rules enforced later)
MAX_FILE_SIZE = "50MB"


@upload(max_size=MAX_FILE_SIZE)
async def upload_attachment(
    file: UploadFile,
    id: str,
) -> UploadAttachmentResult:
    """
    Upload an attachment to pending storage.

    Called immediately when user drops/selects a file.
    The file is stored in pending storage until linked to a chat via link_attachments.

    Args:
        file: The uploaded file
        id: Frontend-generated attachment ID

    Returns:
        Attachment metadata
    """
    content = await file.read()
    extension = get_extension_from_mime(file.content_type)
    media_type = get_media_type(file.content_type)

    # Save to pending storage
    save_pending_attachment(id, content, extension)

    logger.info(
        f"[upload] Saved pending attachment {id}: {file.filename} "
        f"({len(content)} bytes, {file.content_type})"
    )

    return UploadAttachmentResult(
        id=id,
        type=media_type,
        name=file.filename,
        mimeType=file.content_type,
        size=len(content),
    )


@command
async def link_attachments(body: LinkAttachmentsRequest) -> LinkAttachmentsResponse:
    """
    Link pending attachments to a chat.

    Called when a message is sent. Moves files from pending storage to the chat's folder.

    Args:
        body: Contains chatId and list of attachment info

    Returns:
        List of successfully linked IDs and any errors
    """
    linked: list[str] = []
    errors: list[dict] = []

    for att in body.attachments:
        extension = get_extension_from_mime(att.mimeType)
        try:
            move_pending_to_chat(att.id, extension, body.chatId)
            linked.append(att.id)
            logger.info(f"[upload] Linked attachment {att.id} to chat {body.chatId}")
        except FileNotFoundError:
            # File might already be in chat folder (e.g., retry scenario)
            # or might have been cleaned up - treat as success if already there
            from ..services.file_storage import get_attachment_path

            dest = get_attachment_path(body.chatId, att.id, extension)
            if dest.exists():
                linked.append(att.id)
                logger.info(
                    f"[upload] Attachment {att.id} already in chat {body.chatId}"
                )
            else:
                errors.append({"id": att.id, "error": "File not found"})
                logger.warning(f"[upload] Attachment {att.id} not found")
        except Exception as e:
            errors.append({"id": att.id, "error": str(e)})
            logger.error(f"[upload] Failed to link attachment {att.id}: {e}")

    return LinkAttachmentsResponse(linked=linked, errors=errors)


@command
async def delete_pending_upload(body: DeletePendingRequest) -> dict:
    """
    Delete a pending attachment.

    Called when user removes an attachment before sending.

    Args:
        body: Contains attachment ID and mimeType

    Returns:
        Success status
    """
    extension = get_extension_from_mime(body.mimeType)
    deleted = delete_pending_attachment(body.id, extension)

    if deleted:
        logger.info(f"[upload] Deleted pending attachment {body.id}")
    else:
        logger.info(
            f"[upload] Pending attachment {body.id} not found (already deleted)"
        )

    return {"success": True}


@command
async def cleanup_pending() -> dict:
    """
    Clean up all pending uploads.

    Manual cleanup endpoint for orphaned files.

    Returns:
        Number of files cleaned up
    """
    count = cleanup_pending_uploads()
    logger.info(f"[upload] Cleaned up {count} pending uploads")
    return {"cleaned": count}
