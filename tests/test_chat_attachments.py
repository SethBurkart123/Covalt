from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.services import chat_attachments


def test_prepare_stream_attachments_skips_missing_pending_files(tmp_path) -> None:
    attachment = SimpleNamespace(
        id="a1",
        type="image",
        name="photo.png",
        mimeType="image/png",
        size=3,
    )
    missing_path = tmp_path / "missing.png"

    with patch.object(
        chat_attachments,
        "get_pending_attachment_path",
        return_value=missing_path,
    ):
        state = chat_attachments.prepare_stream_attachments(
            "chat-1",
            [attachment],
            source_ref="u1",
        )

    assert state.attachments == []
    assert state.manifest_id is None
    assert state.file_renames == {}


def test_prepare_stream_attachments_adds_and_cleans_files(tmp_path) -> None:
    attachment = SimpleNamespace(
        id="a1",
        type="image",
        name="photo.png",
        mimeType="image/png",
        size=3,
    )
    pending_path = tmp_path / "a1.png"
    pending_path.write_bytes(b"abc")

    workspace_manager = MagicMock()
    workspace_manager.add_files.return_value = (
        "manifest-1",
        {"photo.png": "photo-renamed.png"},
    )

    with (
        patch.object(
            chat_attachments,
            "get_pending_attachment_path",
            return_value=pending_path,
        ),
        patch.object(
            chat_attachments,
            "get_workspace_manager",
            return_value=workspace_manager,
        ),
        patch.object(
            chat_attachments, "_get_parent_manifest_id", return_value="parent-1"
        ),
    ):
        state = chat_attachments.prepare_stream_attachments(
            "chat-1",
            [attachment],
            source_ref="u1",
        )

    workspace_manager.add_files.assert_called_once_with(
        files=[("photo.png", b"abc")],
        parent_manifest_id="parent-1",
        source="user_upload",
        source_ref="u1",
    )
    assert state.manifest_id == "manifest-1"
    assert state.file_renames == {"photo.png": "photo-renamed.png"}
    assert len(state.attachments) == 1
    assert state.attachments[0].name == "photo-renamed.png"
    assert not pending_path.exists()
