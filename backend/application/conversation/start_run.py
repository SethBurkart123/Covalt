from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from zynk import Channel

from ...models.chat import Attachment, ChatMessage
from ...services.chat.chat_attachments import AttachmentMetaLike, StreamAttachmentState


class LoggerLike(Protocol):
    def info(self, msg: str) -> None: ...


@dataclass
class StartRunInput:
    channel: Channel
    messages: list[ChatMessage]
    model_id: str | None = None
    model_options: dict[str, Any] | None = None
    chat_id: str | None = None
    tool_ids: list[str] = field(default_factory=list)
    attachments: Sequence[AttachmentMetaLike] = field(default_factory=list)
    variables: dict[str, Any] | None = None


@dataclass
class StartRunDependencies:
    validate_model_options: Callable[
        [str | None, str | None, dict[str, Any] | None, Channel],
        dict[str, Any] | None,
    ]
    ensure_chat_initialized: Callable[[str | None, str | None], str]
    prepare_stream_attachments: Callable[
        [str, Sequence[AttachmentMetaLike], str | None], StreamAttachmentState
    ]
    get_active_leaf_message_id: Callable[[str], str | None]
    save_user_msg: Callable[
        [ChatMessage, str, str | None, list[Attachment] | None, str | None],
        None,
    ]
    emit_run_started: Callable[[Channel, str, dict[str, str] | None], None]
    init_assistant_msg: Callable[[str, str | None], str]
    emit_assistant_message_id: Callable[[Channel, str], None]
    get_graph_data_for_chat: Callable[[str, str | None, dict[str, Any]], dict[str, Any]]
    run_graph_chat_runtime: Callable[..., Any]
    handle_streaming_run_error: Callable[..., Any]
    logger: LoggerLike


async def execute_start_run(
    input_data: StartRunInput,
    deps: StartRunDependencies,
) -> None:
    validated_model_options: dict[str, Any] = {}

    if input_data.model_id:
        validated_model_options = deps.validate_model_options(
            input_data.chat_id,
            input_data.model_id,
            input_data.model_options,
            input_data.channel,
        )
        if validated_model_options is None:
            return

    chat_id = deps.ensure_chat_initialized(input_data.chat_id, input_data.model_id)

    if not input_data.model_id:
        result = deps.validate_model_options(
            chat_id,
            None,
            input_data.model_options,
            input_data.channel,
        )
        if result is None:
            return
        validated_model_options = result

    saved_attachments: list[Attachment] = []
    manifest_id: str | None = None
    file_renames: dict[str, str] = {}

    if input_data.attachments:
        attachment_state = deps.prepare_stream_attachments(
            chat_id,
            input_data.attachments,
            input_data.messages[-1].id if input_data.messages else None,
        )
        saved_attachments = attachment_state.attachments
        manifest_id = attachment_state.manifest_id
        file_renames = attachment_state.file_renames

    parent_id = deps.get_active_leaf_message_id(chat_id)

    if input_data.messages and input_data.messages[-1].role == "user":
        if saved_attachments:
            input_data.messages[-1].attachments = saved_attachments
        deps.save_user_msg(
            input_data.messages[-1],
            chat_id,
            parent_id,
            saved_attachments or None,
            manifest_id,
        )
        parent_id = input_data.messages[-1].id

    deps.emit_run_started(input_data.channel, chat_id, file_renames)
    assistant_msg_id = deps.init_assistant_msg(chat_id, parent_id)
    deps.emit_assistant_message_id(input_data.channel, assistant_msg_id)

    try:
        graph_data = deps.get_graph_data_for_chat(
            chat_id,
            input_data.model_id,
            validated_model_options,
        )
        deps.logger.info("[stream] Unified chat runtime — running graph runtime")
        await deps.run_graph_chat_runtime(
            graph_data,
            input_data.messages,
            assistant_msg_id,
            input_data.channel,
            chat_id=chat_id,
            ephemeral=False,
            extra_tool_ids=input_data.tool_ids or None,
            variables=input_data.variables,
        )
    except Exception as e:
        await deps.handle_streaming_run_error(
            assistant_msg_id,
            e,
            input_data.channel,
            chat_id=chat_id,
            label="[stream]",
        )
