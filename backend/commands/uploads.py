from __future__ import annotations

import logging

from pydantic import BaseModel
from zynk import UploadFile, command, upload

from ..services.chat.file_storage import (
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
async def upload_attachment(file: UploadFile, id: str) -> UploadAttachmentResult:
    content = await file.read()
    save_pending_attachment(id, content, get_extension_from_mime(file.content_type))
    logger.info(
        f"[upload] Saved pending attachment {id}: {file.filename} ({len(content)} bytes, {file.content_type})"
    )

    return UploadAttachmentResult(
        id=id,
        type=get_media_type(file.content_type),
        name=file.filename,
        mimeType=file.content_type,
        size=len(content),
    )


@command
async def delete_pending_upload(body: DeletePendingRequest) -> dict:
    deleted = delete_pending_attachment(body.id, get_extension_from_mime(body.mimeType))
    logger.info(
        f"[upload] {'Deleted' if deleted else 'Pending attachment not found for'} {body.id}"
    )
    return {"success": True}

