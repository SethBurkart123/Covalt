"""
Upload commands for file attachments.

Provides immediate file upload with progress tracking using zynk's @upload decorator.
Files are stored in pending storage until added to workspace when message is sent.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from ..services.file_storage import (
    cleanup_pending_uploads,
    delete_pending_attachment,
    get_extension_from_mime,
    get_media_type,
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
    Files are stored in pending storage until added to workspace when message is sent.

    Args:
        file: The uploaded file
        id: Frontend-generated attachment ID

    Returns:
        Attachment metadata
    """
    content = await file.read()
    extension = get_extension_from_mime(file.content_type)
    media_type = get_media_type(file.content_type)

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
async def cleanup_pending_uploads_command() -> dict:
    """
    Clean up all pending uploads.

    Manual cleanup endpoint for orphaned files.

    Returns:
        Number of files cleaned up
    """
    count = cleanup_pending_uploads()
    logger.info(f"[upload] Cleaned up {count} pending uploads")
    return {"cleaned": count}
