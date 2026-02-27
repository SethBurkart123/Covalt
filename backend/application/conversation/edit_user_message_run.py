from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from zynk import Channel

from ...models.chat import Attachment, ChatMessage


@dataclass
class ExistingAttachmentInput:
    id: str
    type: str
    name: str
    mimeType: str
    size: int


@dataclass
class NewAttachmentInput:
    id: str
    type: str
    name: str
    mimeType: str
    size: int
    data: str


@dataclass
class EditUserMessageRunInput:
    channel: Channel
    chat_id: str
    message_id: str
    new_content: str
    model_id: Optional[str] = None
    model_options: Optional[Dict[str, Any]] = None
    tool_ids: Optional[List[str]] = None
    existing_attachments: Optional[List[ExistingAttachmentInput]] = None
    new_attachments: Optional[List[NewAttachmentInput]] = None


@dataclass
class EditUserMessageRunDependencies:
    validate_model_options: Callable[
        [str, Optional[str], Optional[Dict[str, Any]], Channel],
        Optional[Dict[str, Any]],
    ]
    update_chat_model_selection: Callable[[Any, str, str], None]
    get_session: Callable[[], Any]
    get_original_message: Callable[[Any, str], Any]
    get_manifest_for_message: Callable[[Any, str], Optional[str]]
    get_workspace_manager: Callable[[str], Any]
    get_extension_from_mime: Callable[[str], str]
    get_pending_attachment_path: Callable[[str, str], Any]
    create_attachment: Callable[[str, str, str, str, int], Attachment]
    create_branch_message: Callable[[Any, Optional[str], str, str, str, bool], str]
    update_message_attachments_and_manifest: Callable[
        [Any, str, Optional[str], Optional[str]],
        None,
    ]
    set_active_leaf: Callable[[Any, str, str], None]
    get_message_path: Callable[[Any, Optional[str]], List[Any]]
    build_message_history: Callable[[List[Any]], List[ChatMessage]]
    create_chat_message: Callable[
        [str, str, str, str, Optional[List[Attachment]]],
        ChatMessage,
    ]
    materialize_to_branch: Callable[[str, str], None]
    emit_run_start_events: Callable[[Channel, str, str], None]
    get_graph_data_for_chat: Callable[[str, Optional[str], Dict[str, Any]], Dict[str, Any]]
    run_graph_chat_runtime: Callable[..., Any]
    append_error_block_to_message: Callable[[str, str], None]
    emit_run_error: Callable[[Channel, str], None]
    logger: Any

def _load_new_attachment_bytes(
    new_att: NewAttachmentInput,
    get_extension_from_mime: Callable[[str], str],
    get_pending_attachment_path: Callable[[str, str], Any],
) -> Optional[bytes]:
    extension = get_extension_from_mime(new_att.mimeType)
    pending_path = get_pending_attachment_path(new_att.id, extension)

    if pending_path.exists():
        content = pending_path.read_bytes()
        pending_path.unlink()
        return content

    if new_att.data:
        return base64.b64decode(new_att.data)

    return None


async def execute_edit_user_message_run(
    input_data: EditUserMessageRunInput,
    deps: EditUserMessageRunDependencies,
) -> None:
    validated_model_options = deps.validate_model_options(
        input_data.chat_id,
        input_data.model_id,
        input_data.model_options,
        input_data.channel,
    )
    if validated_model_options is None:
        return

    file_renames: Dict[str, str] = {}
    manifest_id: Optional[str] = None

    existing_attachments = input_data.existing_attachments or []
    new_attachments = input_data.new_attachments or []

    with deps.get_session() as sess:
        if input_data.model_id:
            deps.update_chat_model_selection(sess, input_data.chat_id, input_data.model_id)

        original_msg = deps.get_original_message(sess, input_data.message_id)
        if not original_msg:
            deps.emit_run_error(input_data.channel, "Message not found")
            return

        original_manifest_id = deps.get_manifest_for_message(sess, original_msg.id)

        all_attachments: List[Attachment] = []
        files_to_add: List[tuple[str, bytes]] = []

        for existing_att in existing_attachments:
            content = None
            if original_manifest_id:
                workspace_manager = deps.get_workspace_manager(input_data.chat_id)
                content = workspace_manager.read_file_from_manifest(
                    original_manifest_id,
                    existing_att.name,
                )

            if content:
                files_to_add.append((existing_att.name, content))
                all_attachments.append(
                    deps.create_attachment(
                        existing_att.id,
                        existing_att.type,
                        existing_att.name,
                        existing_att.mimeType,
                        existing_att.size,
                    )
                )
            else:
                deps.logger.warning(
                    f"Could not find existing attachment '{existing_att.name}' in manifest {original_manifest_id}"
                )

        for new_att in new_attachments:
            content = _load_new_attachment_bytes(
                new_att,
                deps.get_extension_from_mime,
                deps.get_pending_attachment_path,
            )
            if content:
                files_to_add.append((new_att.name, content))

            all_attachments.append(
                deps.create_attachment(
                    new_att.id,
                    new_att.type,
                    new_att.name,
                    new_att.mimeType,
                    new_att.size,
                )
            )

        if files_to_add:
            workspace_manager = deps.get_workspace_manager(input_data.chat_id)
            manifest_id, file_renames = workspace_manager.add_files(
                files=files_to_add,
                parent_manifest_id=None,
                source="user_upload",
                source_ref=None,
            )

            for att in all_attachments:
                if att.name in file_renames:
                    att.name = file_renames[att.name]

        new_user_msg_id = deps.create_branch_message(
            sess,
            original_msg.parent_message_id,
            "user",
            input_data.new_content,
            input_data.chat_id,
            True,
        )

        attachments_json = (
            json.dumps([att.model_dump() for att in all_attachments])
            if all_attachments
            else None
        )
        if attachments_json or manifest_id:
            deps.update_message_attachments_and_manifest(
                sess,
                new_user_msg_id,
                attachments_json,
                manifest_id,
            )

        deps.set_active_leaf(sess, input_data.chat_id, new_user_msg_id)

        messages = (
            deps.get_message_path(sess, original_msg.parent_message_id)
            if original_msg.parent_message_id
            else []
        )
        chat_messages = deps.build_message_history(messages)
        chat_messages.append(
            deps.create_chat_message(
                new_user_msg_id,
                "user",
                input_data.new_content,
                original_msg.createdAt,
                all_attachments if all_attachments else None,
            )
        )

        assistant_msg_id = deps.create_branch_message(
            sess,
            new_user_msg_id,
            "assistant",
            "",
            input_data.chat_id,
            False,
        )

        deps.set_active_leaf(sess, input_data.chat_id, assistant_msg_id)

    deps.materialize_to_branch(input_data.chat_id, new_user_msg_id)
    deps.emit_run_start_events(input_data.channel, input_data.chat_id, assistant_msg_id)

    try:
        graph_data = deps.get_graph_data_for_chat(
            input_data.chat_id,
            input_data.model_id,
            validated_model_options,
        )
        await deps.run_graph_chat_runtime(
            graph_data,
            chat_messages,
            assistant_msg_id,
            input_data.channel,
            chat_id=input_data.chat_id,
            ephemeral=False,
            extra_tool_ids=input_data.tool_ids or None,
        )

    except Exception as e:
        deps.logger.error(f"edit_user_message error: {e}")
        deps.append_error_block_to_message(assistant_msg_id, str(e))
        deps.emit_run_error(input_data.channel, str(e))
