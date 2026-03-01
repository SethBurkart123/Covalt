from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any


class WorkspaceMaterializer:
    def __init__(
        self,
        *,
        chat_id: str,
        workspace_dir: Path,
        manifest_repository: Any,
        blob_store: Any,
    ):
        self.chat_id = chat_id
        self.workspace_dir = workspace_dir
        self._manifest_repository = manifest_repository
        self._blob_store = blob_store

    def materialize(self, manifest_id: str | None = None) -> bool:
        if not manifest_id:
            manifest_id = self._manifest_repository.get_active_manifest_id()

        if not manifest_id:
            if self.workspace_dir.exists():
                shutil.rmtree(self.workspace_dir)
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
            return True

        manifest = self._manifest_repository.get_manifest(manifest_id)
        if not manifest:
            return False

        if self.workspace_dir.exists():
            shutil.rmtree(self.workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        for rel_path, file_hash in manifest["files"].items():
            target = self.workspace_dir / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)

            content = self._blob_store.read(file_hash)
            if content is not None:
                target.write_bytes(content)

        return True
