from __future__ import annotations

import hashlib
from pathlib import Path

from .paths import get_blobs_directory


def compute_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def get_blob_path(chat_id: str, file_hash: str) -> Path:
    blobs_dir = get_blobs_directory(chat_id)
    subdir = blobs_dir / file_hash[:2]
    subdir.mkdir(parents=True, exist_ok=True)
    return subdir / file_hash


class WorkspaceBlobStore:
    def __init__(self, chat_id: str):
        self.chat_id = chat_id

    def store(self, content: bytes) -> str:
        file_hash = compute_hash(content)
        blob_path = get_blob_path(self.chat_id, file_hash)
        if not blob_path.exists():
            blob_path.write_bytes(content)
        return file_hash

    def store_from_path(self, source_path: Path) -> str:
        return self.store(source_path.read_bytes())

    def read(self, file_hash: str) -> bytes | None:
        blob_path = get_blob_path(self.chat_id, file_hash)
        if blob_path.exists():
            return blob_path.read_bytes()
        return None
