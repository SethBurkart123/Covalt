from __future__ import annotations

from pathlib import Path

from ...config import get_db_directory


def get_chats_directory() -> Path:
    chats_dir = get_db_directory() / "chats"
    chats_dir.mkdir(parents=True, exist_ok=True)
    return chats_dir


def get_chat_directory(chat_id: str) -> Path:
    chat_dir = get_chats_directory() / chat_id
    chat_dir.mkdir(parents=True, exist_ok=True)
    return chat_dir


def get_workspace_directory(chat_id: str) -> Path:
    workspace_dir = get_chat_directory(chat_id) / "workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    return workspace_dir


def get_blobs_directory(chat_id: str) -> Path:
    blobs_dir = get_chat_directory(chat_id) / "blobs"
    blobs_dir.mkdir(parents=True, exist_ok=True)
    return blobs_dir
