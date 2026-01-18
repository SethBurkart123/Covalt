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


def _compute_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _get_blob_path(chat_id: str, file_hash: str) -> Path:
    blobs_dir = get_blobs_directory(chat_id)
    subdir = blobs_dir / file_hash[:2]
    subdir.mkdir(parents=True, exist_ok=True)
    return subdir / file_hash


class WorkspaceManager:
    def __init__(self, chat_id: str):
        self.chat_id = chat_id
        self.workspace_dir = get_workspace_directory(chat_id)
        self.blobs_dir = get_blobs_directory(chat_id)

    def store_file(self, content: bytes) -> str:
        file_hash = _compute_hash(content)
        blob_path = _get_blob_path(self.chat_id, file_hash)

        if not blob_path.exists():
            blob_path.write_bytes(content)
            logger.debug(f"Stored blob {file_hash[:12]}... ({len(content)} bytes)")

        return file_hash

    def store_file_from_path(self, source_path: Path) -> str:
        return self.store_file(source_path.read_bytes())

    def get_blob(self, file_hash: str) -> bytes | None:
        blob_path = _get_blob_path(self.chat_id, file_hash)
        if blob_path.exists():
            return blob_path.read_bytes()
        return None

    def get_manifest(self, manifest_id: str) -> dict[str, Any] | None:
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

    def diff_manifests(
        self,
        pre_manifest_id: str | None,
        post_manifest_id: str | None,
    ) -> tuple[list[str], list[str]]:
        pre_files: dict[str, str] = {}
        post_files: dict[str, str] = {}

        if pre_manifest_id:
            pre_manifest = self.get_manifest(pre_manifest_id)
            if pre_manifest:
                pre_files = pre_manifest["files"]

        if post_manifest_id:
            post_manifest = self.get_manifest(post_manifest_id)
            if post_manifest:
                post_files = post_manifest["files"]

        changed: list[str] = []
        deleted: list[str] = []

        for path, file_hash in post_files.items():
            if path not in pre_files or pre_files[path] != file_hash:
                changed.append(path)

        for path in pre_files:
            if path not in post_files:
                deleted.append(path)

        return changed, deleted

    def get_active_manifest_id(self) -> str | None:
        if hasattr(self, "_local_manifest_id"):
            return self._local_manifest_id

        with db_session() as session:
            chat = session.query(Chat).filter(Chat.id == self.chat_id).first()
            if chat:
                return chat.active_manifest_id
            return None

    def set_active_manifest_id(self, manifest_id: str | None) -> None:
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

    def add_files(
        self,
        files: list[tuple[str, bytes]],
        parent_manifest_id: str | None = None,
        source: str = "user_upload",
        source_ref: str | None = None,
        set_active: bool = True,
        inherit_active: bool = False,
    ) -> tuple[str, dict[str, str]]:
        if parent_manifest_id is None and inherit_active:
            parent_manifest_id = self.get_active_manifest_id()

        current_files: dict[str, str] = {}
        if parent_manifest_id:
            manifest = self.get_manifest(parent_manifest_id)
            if manifest:
                current_files = manifest["files"].copy()

        rename_map: dict[str, str] = {}

        for original_name, content in files:
            final_name = self._resolve_collision(original_name, current_files)

            if final_name != original_name:
                rename_map[original_name] = final_name
                logger.info(
                    f"Renamed '{original_name}' -> '{final_name}' due to collision"
                )

            file_hash = self.store_file(content)
            current_files[final_name] = file_hash

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
        manifest = self.get_manifest(manifest_id)
        if not manifest:
            return None

        files = manifest["files"]
        if rel_path not in files:
            return None

        file_hash = files[rel_path]
        return self.get_blob(file_hash)

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
        files = []
        if not directory.exists():
            return files

        for item in directory.rglob("*"):
            if item.is_file() and not any(part.startswith(".") for part in item.parts):
                files.append(item)

        return sorted(files)

    def cleanup(self) -> None:
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
