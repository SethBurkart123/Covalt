"""File storage utilities for pending chat attachments."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from ..config import get_pending_uploads_directory

AttachmentType = Literal["image", "file", "audio", "video"]


def get_media_type(mime_type: str) -> AttachmentType:
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    return "file"


def get_extension_from_mime(mime_type: str) -> str:
    mime_to_ext = {
        # Images
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        # Audio
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/aac": "aac",
        "audio/flac": "flac",
        # Video
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/ogg": "ogv",
        "video/quicktime": "mov",
        # Documents
        "application/pdf": "pdf",
        "text/plain": "txt",
        "text/csv": "csv",
        "application/json": "json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
    }
    return mime_to_ext.get(mime_type, "bin")


def get_pending_uploads_dir() -> Path:
    return get_pending_uploads_directory()


def get_pending_attachment_path(attachment_id: str, extension: str) -> Path:
    return get_pending_uploads_dir() / f"{attachment_id}.{extension}"


def save_pending_attachment(
    attachment_id: str, file_data: bytes, extension: str
) -> Path:
    path = get_pending_attachment_path(attachment_id, extension)
    path.write_bytes(file_data)
    return path


def pending_attachment_exists(attachment_id: str, extension: str) -> bool:
    return get_pending_attachment_path(attachment_id, extension).exists()


def delete_pending_attachment(attachment_id: str, extension: str) -> bool:
    path = get_pending_attachment_path(attachment_id, extension)
    if path.exists():
        path.unlink()
        return True
    return False


def cleanup_pending_uploads() -> int:
    pending_dir = get_pending_uploads_dir()
    count = 0
    if pending_dir.exists():
        for file in pending_dir.iterdir():
            if file.is_file():
                file.unlink()
                count += 1
    return count
