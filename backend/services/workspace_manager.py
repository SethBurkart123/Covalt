from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from ..db import db_session
from .workspace import (
    WorkspaceBlobStore,
    WorkspaceDiffService,
    WorkspaceManifestRepository,
    WorkspaceMaterializer,
    get_blobs_directory as _get_blobs_directory,
    get_chat_directory as _get_chat_directory,
    get_chats_directory as _get_chats_directory,
    get_workspace_directory as _get_workspace_directory,
)

logger = logging.getLogger(__name__)


def get_chats_directory() -> Path:
    return _get_chats_directory()


def get_chat_directory(chat_id: str) -> Path:
    return _get_chat_directory(chat_id)


def get_workspace_directory(chat_id: str) -> Path:
    return _get_workspace_directory(chat_id)


def get_blobs_directory(chat_id: str) -> Path:
    return _get_blobs_directory(chat_id)


class WorkspaceManager:
    def __init__(self, chat_id: str):
        self.chat_id = chat_id
        self.workspace_dir = get_workspace_directory(chat_id)
        self.blobs_dir = get_blobs_directory(chat_id)
        self._blob_store = WorkspaceBlobStore(chat_id)
        self._manifest_repository = WorkspaceManifestRepository(chat_id)
        self._diff_service = WorkspaceDiffService(self._manifest_repository)
        self._materializer = WorkspaceMaterializer(
            chat_id=chat_id,
            workspace_dir=self.workspace_dir,
            manifest_repository=self._manifest_repository,
            blob_store=self._blob_store,
        )

    def store_file(self, content: bytes) -> str:
        file_hash = self._blob_store.store(content)
        logger.debug(f"Stored blob {file_hash[:12]}... ({len(content)} bytes)")
        return file_hash

    def store_file_from_path(self, source_path: Path) -> str:
        return self._blob_store.store_from_path(source_path)

    def get_blob(self, file_hash: str) -> bytes | None:
        return self._blob_store.read(file_hash)

    def get_manifest(self, manifest_id: str) -> dict[str, Any] | None:
        return self._manifest_repository.get_manifest(manifest_id)

    def diff_manifests(
        self,
        pre_manifest_id: str | None,
        post_manifest_id: str | None,
    ) -> tuple[list[str], list[str]]:
        return self._diff_service.diff_manifests(pre_manifest_id, post_manifest_id)

    def get_active_manifest_id(self) -> str | None:
        if hasattr(self, "_local_manifest_id"):
            return self._local_manifest_id
        return self._manifest_repository.get_active_manifest_id()

    def set_active_manifest_id(self, manifest_id: str | None) -> None:
        if not self._manifest_repository.set_active_manifest_id(manifest_id):
            self._local_manifest_id = manifest_id

    def create_manifest(
        self,
        files: dict[str, str],
        parent_id: str | None = None,
        source: str = "initial",
        source_ref: str | None = None,
    ) -> str:
        manifest_id = self._manifest_repository.create_manifest(
            files,
            parent_id=parent_id,
            source=source,
            source_ref=source_ref,
        )
        logger.info(
            f"Created manifest {manifest_id[:8]}... for chat {self.chat_id[:8]}..."
        )
        return manifest_id

    def materialize(self, manifest_id: str | None = None) -> bool:
        result = self._materializer.materialize(manifest_id)
        if not result and manifest_id:
            logger.warning(f"Manifest {manifest_id} not found")
        return result

    def snapshot(
        self,
        source: str = "tool_run",
        source_ref: str | None = None,
        set_active: bool = True,
    ) -> str:
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
        target = self.workspace_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

        current_files: dict[str, str] = {}
        if parent_id := self.get_active_manifest_id():
            if manifest := self.get_manifest(parent_id):
                current_files = manifest["files"].copy()

        current_files[rel_path] = self.store_file(content)

        manifest_id = self.create_manifest(
            files=current_files,
            parent_id=parent_id,
            source=source,
            source_ref=source_ref,
        )

        self.set_active_manifest_id(manifest_id)
        return manifest_id

    def add_files(
        self,
        files: list[tuple[str, bytes]],
        parent_manifest_id: str | None = None,
        source: str = "user_upload",
        source_ref: str | None = None,
        set_active: bool = True,
        inherit_active: bool = False,
    ) -> tuple[str, dict[str, str]]:
        if not parent_manifest_id and inherit_active:
            parent_manifest_id = self.get_active_manifest_id()

        current_files: dict[str, str] = {}
        if parent_manifest_id and (manifest := self.get_manifest(parent_manifest_id)):
            current_files = manifest["files"].copy()

        rename_map: dict[str, str] = {}

        for original_name, content in files:
            final_name = self._resolve_collision(original_name, current_files)

            if final_name != original_name:
                rename_map[original_name] = final_name
                logger.info(
                    f"Renamed '{original_name}' -> '{final_name}' due to collision"
                )

            current_files[final_name] = self.store_file(content)

        manifest_id = self.create_manifest(
            files=current_files,
            parent_id=parent_manifest_id,
            source=source,
            source_ref=source_ref,
        )

        if set_active:
            self.set_active_manifest_id(manifest_id)
            self.materialize(manifest_id)

        logger.info(
            f"Added {len(files)} files to workspace, "
            f"{len(rename_map)} renamed, manifest {manifest_id[:8]}..."
        )

        return manifest_id, rename_map

    def _resolve_collision(self, filename: str, existing_files: dict[str, str]) -> str:
        if filename not in existing_files:
            return filename

        if "." in filename:
            base, ext = filename.rsplit(".", 1)
            ext = "." + ext
        else:
            base = filename
            ext = ""

        counter = 1
        while True:
            candidate = f"{base}_{counter}{ext}"
            if candidate not in existing_files:
                return candidate
            counter += 1

    def read_file_from_manifest(self, manifest_id: str, rel_path: str) -> bytes | None:
        if not (manifest := self.get_manifest(manifest_id)):
            return None

        if rel_path not in manifest["files"]:
            return None

        return self.get_blob(manifest["files"][rel_path])

    def list_files(self) -> list[str]:
        return [
            str(p.relative_to(self.workspace_dir))
            for p in self._walk_files(self.workspace_dir)
        ]

    def read_file(self, rel_path: str) -> bytes | None:
        file_path = self.workspace_dir / rel_path
        if file_path.exists() and file_path.is_file():
            return file_path.read_bytes()
        return None

    def write_file(self, rel_path: str, content: bytes) -> None:
        target = self.workspace_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def delete_file(self, rel_path: str) -> bool:
        file_path = self.workspace_dir / rel_path
        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            return True
        return False

    def _walk_files(self, directory: Path) -> list[Path]:
        if not directory.exists():
            return []

        files = [
            item
            for item in directory.rglob("*")
            if item.is_file() and not any(part.startswith(".") for part in item.parts)
        ]
        return sorted(files)

    def cleanup(self) -> None:
        referenced: set[str] = set()
        for files in self._manifest_repository.list_manifest_file_maps():
            referenced.update(files.values())

        removed = 0
        for subdir in self.blobs_dir.iterdir():
            if not subdir.is_dir():
                continue
            for blob_file in subdir.iterdir():
                if blob_file.name not in referenced:
                    blob_file.unlink()
                    removed += 1

            if not any(subdir.iterdir()):
                subdir.rmdir()

        if removed:
            logger.info(
                f"Cleaned up {removed} unreferenced blobs for chat {self.chat_id[:8]}..."
            )


_workspace_managers: dict[str, WorkspaceManager] = {}


def get_workspace_manager(chat_id: str) -> WorkspaceManager:
    if chat_id not in _workspace_managers:
        _workspace_managers[chat_id] = WorkspaceManager(chat_id)
    return _workspace_managers[chat_id]


def materialize_to_branch(chat_id: str, message_id: str) -> None:
    from ..db.chats import get_manifest_for_message

    with db_session() as sess:
        manifest_id = get_manifest_for_message(sess, message_id)

    workspace_manager = get_workspace_manager(chat_id)
    workspace_manager.materialize(manifest_id)
    if manifest_id:
        workspace_manager.set_active_manifest_id(manifest_id)


def clear_workspace_manager_cache(chat_id: str | None = None) -> None:
    if chat_id:
        _workspace_managers.pop(chat_id, None)
    else:
        _workspace_managers.clear()


def delete_chat_workspace(chat_id: str) -> None:
    clear_workspace_manager_cache(chat_id)

    chat_dir = get_chat_directory(chat_id)
    if chat_dir.exists():
        shutil.rmtree(chat_dir)
        logger.info(f"Deleted workspace for chat {chat_id[:8]}...")
