from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from zynk import Channel

from ...models.chat import ChatMessage


@dataclass
class RetryRunInput:
    channel: Channel
    chat_id: str
    message_id: str
    model_id: Optional[str] = None
    model_options: Optional[Dict[str, Any]] = None
    tool_ids: Optional[List[str]] = None


@dataclass
class RetryRunDependencies:
    validate_model_options: Callable[
        [str, Optional[str], Optional[Dict[str, Any]], Channel],
        Optional[Dict[str, Any]],
    ]
    update_chat_model_selection: Callable[[Any, str, str], None]
    get_session: Callable[[], Any]
    get_original_message: Callable[[Any, str], Any]
    get_message_path: Callable[[Any, Optional[str]], List[Any]]
    build_message_history: Callable[[List[Any]], List[ChatMessage]]
    create_branch_message: Callable[[Any, Optional[str], str, str, str, bool], str]
    set_active_leaf: Callable[[Any, str, str], None]
    materialize_to_branch: Callable[[str, str], None]
    emit_run_start_events: Callable[[Channel, str, str], None]
    get_graph_data_for_chat: Callable[[str, Optional[str], Dict[str, Any]], Dict[str, Any]]
    run_graph_chat_runtime: Callable[..., Any]
    append_error_block_to_message: Callable[[str, str], None]
    emit_run_error: Callable[[Channel, str], None]
    logger: Any


async def execute_retry_run(
    input_data: RetryRunInput,
    deps: RetryRunDependencies,
) -> None:
    validated_model_options = deps.validate_model_options(
        input_data.chat_id,
        input_data.model_id,
        input_data.model_options,
        input_data.channel,
    )
    if validated_model_options is None:
        return

    parent_msg_id: Optional[str] = None

    with deps.get_session() as sess:
        if input_data.model_id:
            deps.update_chat_model_selection(sess, input_data.chat_id, input_data.model_id)

        original_msg = deps.get_original_message(sess, input_data.message_id)
        if not original_msg:
            deps.emit_run_error(input_data.channel, "Message not found")
            return

        messages = (
            deps.get_message_path(sess, original_msg.parent_message_id)
            if original_msg.parent_message_id
            else []
        )
        chat_messages = deps.build_message_history(messages)

        new_msg_id = deps.create_branch_message(
            sess,
            original_msg.parent_message_id,
            "assistant",
            "",
            input_data.chat_id,
            False,
        )

        deps.set_active_leaf(sess, input_data.chat_id, new_msg_id)
        parent_msg_id = original_msg.parent_message_id

    if parent_msg_id:
        deps.materialize_to_branch(input_data.chat_id, parent_msg_id)

    deps.emit_run_start_events(input_data.channel, input_data.chat_id, new_msg_id)

    try:
        graph_data = deps.get_graph_data_for_chat(
            input_data.chat_id,
            input_data.model_id,
            validated_model_options,
        )
        await deps.run_graph_chat_runtime(
            graph_data,
            chat_messages,
            new_msg_id,
            input_data.channel,
            chat_id=input_data.chat_id,
            ephemeral=False,
            extra_tool_ids=input_data.tool_ids or None,
        )

    except Exception as e:
        deps.logger.error(f"retry_message error: {e}")
        deps.append_error_block_to_message(new_msg_id, str(e))
        deps.emit_run_error(input_data.channel, str(e))
