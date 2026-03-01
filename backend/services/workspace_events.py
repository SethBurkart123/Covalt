from __future__ import annotations

from pydantic import BaseModel


class WorkspaceFilesChanged(BaseModel):
    chat_id: str
    changed_paths: list[str]
    deleted_paths: list[str]
