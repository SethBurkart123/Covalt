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
    id: str
    type: str
    name: str
    mimeType: str
    size: int


class DeletePendingRequest(BaseModel):
    id: str
    mimeType: str


MAX_FILE_SIZE = "50MB"


@upload(max_size=MAX_FILE_SIZE)
async def upload_attachment(
    file: UploadFile,
    id: str,
) -> UploadAttachmentResult:
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
    count = cleanup_pending_uploads()
    logger.info(f"[upload] Cleaned up {count} pending uploads")
    return {"cleaned": count}
