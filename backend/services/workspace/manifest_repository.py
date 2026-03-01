from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from ...db import db_session
from ...db.models import Chat, WorkspaceManifest


class WorkspaceManifestRepository:
    def __init__(self, chat_id: str):
        self.chat_id = chat_id

    def get_manifest(self, manifest_id: str) -> dict[str, Any] | None:
        with db_session() as session:
            manifest = (
                session.query(WorkspaceManifest)
                .filter(WorkspaceManifest.id == manifest_id)
                .first()
            )
            if not manifest:
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

    def create_manifest(
        self,
        files: dict[str, str],
        *,
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

        return manifest_id

    def get_active_manifest_id(self) -> str | None:
        with db_session() as session:
            chat = session.query(Chat).filter(Chat.id == self.chat_id).first()
            return chat.active_manifest_id if chat else None

    def set_active_manifest_id(self, manifest_id: str | None) -> bool:
        with db_session() as session:
            chat = session.query(Chat).filter(Chat.id == self.chat_id).first()
            if not chat:
                return False
            chat.active_manifest_id = manifest_id
            session.commit()
            return True

    def list_manifest_file_maps(self) -> list[dict[str, str]]:
        with db_session() as session:
            manifests = (
                session.query(WorkspaceManifest)
                .filter(WorkspaceManifest.chat_id == self.chat_id)
                .all()
            )
            return [json.loads(manifest.files) for manifest in manifests]
