"""
Workspace Manager - handles per-chat CAS (Content-Addressable Storage) workspaces.

Each chat has:
- workspace/  - materialized working directory (latest leaf state)
- blobs/      - content-addressed file storage

Provides:
- store_file: hash and store content, return hash
- create_manifest: create a manifest from files
- materialize: copy files from blob store into workspace
- snapshot: capture workspace state as a new manifest
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import get_db_directory
from ..db import db_session
from ..db.models import Chat, WorkspaceManifest

logger = logging.getLogger(__name__)


def get_chats_directory() -> Path:
    """Get the base directory for all chat data."""
    chats_dir = get_db_directory() / "chats"
    chats_dir.mkdir(parents=True, exist_ok=True)
    return chats_dir


def get_chat_directory(chat_id: str) -> Path:
    """Get the directory for a specific chat."""
    chat_dir = get_chats_directory() / chat_id
    chat_dir.mkdir(parents=True, exist_ok=True)
    return chat_dir


def get_workspace_directory(chat_id: str) -> Path:
    """Get the materialized workspace directory for a chat."""
    workspace_dir = get_chat_directory(chat_id) / "workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    return workspace_dir


def get_blobs_directory(chat_id: str) -> Path:
    """Get the blob storage directory for a chat."""
    blobs_dir = get_chat_directory(chat_id) / "blobs"
    blobs_dir.mkdir(parents=True, exist_ok=True)
    return blobs_dir


def _compute_hash(content: bytes) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content).hexdigest()


def _get_blob_path(chat_id: str, file_hash: str) -> Path:
    """Get the path for a blob file (uses first 2 chars as subdirectory)."""
    blobs_dir = get_blobs_directory(chat_id)
    subdir = blobs_dir / file_hash[:2]
    subdir.mkdir(parents=True, exist_ok=True)
    return subdir / file_hash


class WorkspaceManager:
    """
    Manages workspace versioning for a chat using content-addressable storage.

    Usage:
        manager = WorkspaceManager(chat_id)

        # Store a file
        file_hash = manager.store_file(content)

        # Create a manifest from current workspace
        manifest_id = manager.snapshot(source="tool_run", source_ref="tool_call_123")

        # Materialize workspace to a specific manifest
        manager.materialize(manifest_id)
    """

    def __init__(self, chat_id: str):
        self.chat_id = chat_id
        self.workspace_dir = get_workspace_directory(chat_id)
        self.blobs_dir = get_blobs_directory(chat_id)

    def store_file(self, content: bytes) -> str:
        """
        Store content in blob storage by its hash.

        Args:
            content: File content as bytes

        Returns:
            SHA-256 hash of the content
        """
        file_hash = _compute_hash(content)
        blob_path = _get_blob_path(self.chat_id, file_hash)

        if not blob_path.exists():
            blob_path.write_bytes(content)
            logger.debug(f"Stored blob {file_hash[:12]}... ({len(content)} bytes)")

        return file_hash

    def store_file_from_path(self, source_path: Path) -> str:
        """
        Store a file from disk into blob storage.

        Args:
            source_path: Path to the file to store

        Returns:
            SHA-256 hash of the content
        """
        content = source_path.read_bytes()
        return self.store_file(content)

    def get_blob(self, file_hash: str) -> bytes | None:
        """
        Retrieve content from blob storage.

        Args:
            file_hash: SHA-256 hash of the content

        Returns:
            File content, or None if not found
        """
        blob_path = _get_blob_path(self.chat_id, file_hash)
        if blob_path.exists():
            return blob_path.read_bytes()
        return None

    def get_manifest(self, manifest_id: str) -> dict[str, Any] | None:
        """
        Get a manifest by ID.

        Args:
            manifest_id: Manifest ID

        Returns:
            Manifest dict with files, parent_id, etc., or None if not found
        """
        with db_session() as session:
            manifest = (
                session.query(WorkspaceManifest)
                .filter(WorkspaceManifest.id == manifest_id)
                .first()
            )

            if manifest is None:
                return None

            return {
                "id": manifest.id,
                "chat_id": manifest.chat_id,
                "parent_id": manifest.parent_id,
                "files": json.loads(manifest.files),
                "created_at": manifest.created_at,
                "source": manifest.source,
                "source_ref": manifest.source_ref,
            }

    def get_active_manifest_id(self) -> str | None:
        """Get the active manifest ID for this chat."""
        # First check if we have a local override (for chats not yet in DB)
        if hasattr(self, "_local_manifest_id"):
            return self._local_manifest_id

        with db_session() as session:
            chat = session.query(Chat).filter(Chat.id == self.chat_id).first()
            if chat:
                return chat.active_manifest_id
            return None

    def set_active_manifest_id(self, manifest_id: str | None) -> None:
        """Set the active manifest ID for this chat."""
        with db_session() as session:
            chat = session.query(Chat).filter(Chat.id == self.chat_id).first()
            if chat:
                chat.active_manifest_id = manifest_id
                session.commit()
            else:
                self._local_manifest_id = manifest_id

    def create_manifest(
        self,
        files: dict[str, str],
        parent_id: str | None = None,
        source: str = "initial",
        source_ref: str | None = None,
    ) -> str:
        """
        Create a new manifest.

        Args:
            files: Dict mapping relative paths to content hashes
            parent_id: Optional parent manifest ID (for branching)
            source: Source type ("initial", "user_upload", "tool_run", "branch", "edit")
            source_ref: Optional reference (message_id, tool_call_id, etc.)

        Returns:
            New manifest ID
        """
        manifest_id = str(uuid.uuid4())

        with db_session() as session:
            manifest = WorkspaceManifest(
                id=manifest_id,
                chat_id=self.chat_id,
                parent_id=parent_id,
                files=json.dumps(files),
                created_at=datetime.now().isoformat(),
                source=source,
                source_ref=source_ref,
            )
            session.add(manifest)
            session.commit()

        logger.info(
            f"Created manifest {manifest_id[:8]}... for chat {self.chat_id[:8]}..."
        )
        return manifest_id

    def materialize(self, manifest_id: str | None = None) -> bool:
        """
        Materialize workspace to a specific manifest state.

        Clears the workspace directory and copies files from blob storage
        according to the manifest.

        Args:
            manifest_id: Manifest to materialize. If None, uses active manifest.

        Returns:
            True if successful, False if manifest not found
        """
        if manifest_id is None:
            manifest_id = self.get_active_manifest_id()

        if manifest_id is None:
            if self.workspace_dir.exists():
                shutil.rmtree(self.workspace_dir)
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
            return True

        manifest = self.get_manifest(manifest_id)
        if manifest is None:
            logger.warning(f"Manifest {manifest_id} not found")
            return False

        if self.workspace_dir.exists():
            shutil.rmtree(self.workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        files = manifest["files"]
        for rel_path, file_hash in files.items():
            target = self.workspace_dir / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)

            blob_path = _get_blob_path(self.chat_id, file_hash)
            if blob_path.exists():
                shutil.copy2(blob_path, target)
            else:
                logger.warning(f"Blob {file_hash[:12]}... not found for {rel_path}")

        logger.info(
            f"Materialized {len(files)} files for manifest {manifest_id[:8]}..."
        )
        return True

    def snapshot(
        self,
        source: str = "tool_run",
        source_ref: str | None = None,
        set_active: bool = True,
    ) -> str:
        """
        Snapshot current workspace state as a new manifest.

        Walks the workspace directory, stores any new/changed files in blob
        storage, and creates a new manifest.

        Args:
            source: Source type for the manifest
            source_ref: Optional reference (message_id, tool_call_id)
            set_active: Whether to set this as the active manifest

        Returns:
            New manifest ID
        """
        parent_id = self.get_active_manifest_id()
        files: dict[str, str] = {}

        for file_path in self._walk_files(self.workspace_dir):
            rel_path = str(file_path.relative_to(self.workspace_dir))
            content = file_path.read_bytes()
            file_hash = self.store_file(content)
            files[rel_path] = file_hash

        manifest_id = self.create_manifest(
            files=files,
            parent_id=parent_id,
            source=source,
            source_ref=source_ref,
        )

        if set_active:
            self.set_active_manifest_id(manifest_id)

        return manifest_id

    def add_file(
        self,
        rel_path: str,
        content: bytes,
        source: str = "user_upload",
        source_ref: str | None = None,
    ) -> str:
        """
        Add or update a single file and create a new manifest.

        Args:
            rel_path: Relative path in workspace
            content: File content
            source: Source type
            source_ref: Optional reference

        Returns:
            New manifest ID
        """
        target = self.workspace_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

        file_hash = self.store_file(content)

        parent_id = self.get_active_manifest_id()
        current_files: dict[str, str] = {}
        if parent_id:
            manifest = self.get_manifest(parent_id)
            if manifest:
                current_files = manifest["files"].copy()

        current_files[rel_path] = file_hash

        manifest_id = self.create_manifest(
            files=current_files,
            parent_id=parent_id,
            source=source,
            source_ref=source_ref,
        )

        self.set_active_manifest_id(manifest_id)
        return manifest_id

    def list_files(self) -> list[str]:
        """List all files in the current workspace."""
        return [
            str(p.relative_to(self.workspace_dir))
            for p in self._walk_files(self.workspace_dir)
        ]

    def read_file(self, rel_path: str) -> bytes | None:
        """Read a file from the workspace."""
        file_path = self.workspace_dir / rel_path
        if file_path.exists() and file_path.is_file():
            return file_path.read_bytes()
        return None

    def write_file(self, rel_path: str, content: bytes) -> None:
        """Write a file to the workspace (does not create manifest)."""
        target = self.workspace_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def delete_file(self, rel_path: str) -> bool:
        """Delete a file from the workspace (does not create manifest)."""
        file_path = self.workspace_dir / rel_path
        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            return True
        return False

    def _walk_files(self, directory: Path) -> list[Path]:
        """Walk directory and return all file paths (excluding hidden files)."""
        files = []
        if not directory.exists():
            return files

        for item in directory.rglob("*"):
            if item.is_file() and not any(part.startswith(".") for part in item.parts):
                files.append(item)

        return sorted(files)

    def cleanup(self) -> None:
        """Clean up unreferenced blobs."""
        referenced: set[str] = set()
        with db_session() as session:
            manifests = (
                session.query(WorkspaceManifest)
                .filter(WorkspaceManifest.chat_id == self.chat_id)
                .all()
            )

            for manifest in manifests:
                files = json.loads(manifest.files)
                referenced.update(files.values())

        removed = 0
        for subdir in self.blobs_dir.iterdir():
            if subdir.is_dir():
                for blob_file in subdir.iterdir():
                    if blob_file.name not in referenced:
                        blob_file.unlink()
                        removed += 1

                # Remove empty subdirs
                if not any(subdir.iterdir()):
                    subdir.rmdir()

        if removed > 0:
            logger.info(
                f"Cleaned up {removed} unreferenced blobs for chat {self.chat_id[:8]}..."
            )


# Cache of workspace managers per chat_id
_workspace_managers: dict[str, WorkspaceManager] = {}


def get_workspace_manager(chat_id: str) -> WorkspaceManager:
    """Get a workspace manager for a chat (cached per chat_id)."""
    if chat_id not in _workspace_managers:
        _workspace_managers[chat_id] = WorkspaceManager(chat_id)
    return _workspace_managers[chat_id]


def clear_workspace_manager_cache(chat_id: str | None = None) -> None:
    """Clear workspace manager cache for a chat or all chats."""
    if chat_id:
        _workspace_managers.pop(chat_id, None)
    else:
        _workspace_managers.clear()


def delete_chat_workspace(chat_id: str) -> None:
    """Delete all workspace data for a chat."""
    # Clear cached workspace manager
    clear_workspace_manager_cache(chat_id)

    chat_dir = get_chat_directory(chat_id)
    if chat_dir.exists():
        shutil.rmtree(chat_dir)
        logger.info(f"Deleted workspace for chat {chat_id[:8]}...")
