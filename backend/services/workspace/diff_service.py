from __future__ import annotations

from typing import Any


class WorkspaceDiffService:
    def __init__(self, manifest_repository: Any):
        self._manifest_repository = manifest_repository

    def diff_manifests(
        self,
        pre_manifest_id: str | None,
        post_manifest_id: str | None,
    ) -> tuple[list[str], list[str]]:
        pre_files: dict[str, str] = {}
        post_files: dict[str, str] = {}

        if pre_manifest_id and (
            pre_manifest := self._manifest_repository.get_manifest(pre_manifest_id)
        ):
            pre_files = pre_manifest["files"]

        if post_manifest_id and (
            post_manifest := self._manifest_repository.get_manifest(post_manifest_id)
        ):
            post_files = post_manifest["files"]

        changed = [
            path
            for path, file_hash in post_files.items()
            if path not in pre_files or pre_files[path] != file_hash
        ]
        deleted = [path for path in pre_files if path not in post_files]

        return changed, deleted
