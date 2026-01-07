"""File storage utilities for chat attachments."""

from __future__ import annotations

import base64
import shutil
from pathlib import Path
from typing import Literal

from ..config import get_chat_files_directory

AttachmentType = Literal["image", "file", "audio", "video"]

PENDING_UPLOADS_DIR = "_pending"


def get_media_type(mime_type: str) -> AttachmentType:
    """Map MIME type to attachment type category."""
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    return "file"


def get_extension_from_mime(mime_type: str) -> str:
    """Extract file extension from MIME type."""
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


def get_chat_attachment_dir(chat_id: str) -> Path:
    """Get directory for a specific chat's attachments."""
    chat_dir = get_chat_files_directory() / chat_id
    chat_dir.mkdir(parents=True, exist_ok=True)
    return chat_dir


def get_attachment_path(chat_id: str, attachment_id: str, extension: str) -> Path:
    """Get the file path for an attachment."""
    return get_chat_attachment_dir(chat_id) / f"{attachment_id}.{extension}"


def save_attachment(
    chat_id: str, attachment_id: str, file_data: bytes, extension: str
) -> Path:
    """
    Save attachment bytes to disk.

    Args:
        chat_id: The chat ID
        attachment_id: Unique ID for the attachment
        file_data: Raw bytes of the file
        extension: File extension (without dot)

    Returns:
        Path to the saved file
    """
    path = get_attachment_path(chat_id, attachment_id, extension)
    path.write_bytes(file_data)
    return path


def save_attachment_from_base64(
    chat_id: str, attachment_id: str, base64_data: str, extension: str
) -> Path:
    """
    Save base64-encoded attachment to disk.

    Args:
        chat_id: The chat ID
        attachment_id: Unique ID for the attachment
        base64_data: Base64-encoded file content
        extension: File extension (without dot)

    Returns:
        Path to the saved file
    """
    file_data = base64.b64decode(base64_data)
    return save_attachment(chat_id, attachment_id, file_data, extension)


def delete_chat_attachments(chat_id: str) -> None:
    """
    Delete all attachments for a chat.

    Args:
        chat_id: The chat ID whose attachments should be deleted
    """
    chat_dir = get_chat_files_directory() / chat_id
    if chat_dir.exists():
        shutil.rmtree(chat_dir)


def load_attachment_bytes(chat_id: str, attachment_id: str, extension: str) -> bytes:
    """
    Load attachment bytes from disk.

    Args:
        chat_id: The chat ID
        attachment_id: The attachment ID
        extension: File extension

    Returns:
        Raw bytes of the file
    """
    path = get_attachment_path(chat_id, attachment_id, extension)
    return path.read_bytes()


load_attachment = load_attachment_bytes


def get_pending_uploads_dir() -> Path:
    """Get directory for temporary (pending) uploads before they're linked to a chat."""
    pending_dir = get_chat_files_directory() / PENDING_UPLOADS_DIR
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir


def get_pending_attachment_path(attachment_id: str, extension: str) -> Path:
    """Get file path for a pending (temp) attachment."""
    return get_pending_uploads_dir() / f"{attachment_id}.{extension}"


def save_pending_attachment(
    attachment_id: str, file_data: bytes, extension: str
) -> Path:
    """
    Save attachment to pending/temp storage.

    Args:
        attachment_id: Unique ID for the attachment
        file_data: Raw bytes of the file
        extension: File extension (without dot)

    Returns:
        Path to the saved file
    """
    path = get_pending_attachment_path(attachment_id, extension)
    path.write_bytes(file_data)
    return path


def move_pending_to_chat(attachment_id: str, extension: str, chat_id: str) -> Path:
    """
    Move a pending attachment from temp storage to a chat's folder.

    Args:
        attachment_id: The attachment ID
        extension: File extension
        chat_id: The chat ID to move the file to

    Returns:
        Path to the final location
    """
    source = get_pending_attachment_path(attachment_id, extension)
    dest = get_attachment_path(chat_id, attachment_id, extension)

    if source.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(dest))
    elif not dest.exists():
        raise FileNotFoundError(
            f"Attachment {attachment_id} not found in pending or chat storage"
        )

    return dest


def pending_attachment_exists(attachment_id: str, extension: str) -> bool:
    """Check if a pending attachment exists."""
    return get_pending_attachment_path(attachment_id, extension).exists()


def delete_pending_attachment(attachment_id: str, extension: str) -> bool:
    """
    Delete a pending attachment.

    Returns:
        True if file was deleted, False if it didn't exist
    """
    path = get_pending_attachment_path(attachment_id, extension)
    if path.exists():
        path.unlink()
        return True
    return False


def cleanup_pending_uploads() -> int:
    """
    Clean up all pending uploads. Called manually when needed.

    Returns:
        Number of files deleted
    """
    pending_dir = get_pending_uploads_dir()
    count = 0
    if pending_dir.exists():
        for file in pending_dir.iterdir():
            if file.is_file():
                file.unlink()
                count += 1
    return count
