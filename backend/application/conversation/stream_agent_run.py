from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from zynk import Channel

from ...models.chat import ChatMessage


@dataclass
class StreamAgentRunInput:
    channel: Channel
    agent_id: str
    messages: List[ChatMessage]
    chat_id: Optional[str] = None
    ephemeral: bool = False


@dataclass
class StreamAgentRunDependencies:
    get_agent_data: Callable[[str], Optional[Dict[str, Any]]]
    emit_run_error: Callable[[Channel, str], None]
    ensure_chat_initialized: Callable[[Optional[str], Optional[str]], str]
    get_active_leaf_message_id: Callable[[str], Optional[str]]
    save_user_message: Callable[..., None]
    init_assistant_message: Callable[[str, Optional[str]], str]
    emit_run_start_events: Callable[[Channel, Optional[str], str], None]
    run_graph_chat_runtime: Callable[..., Any]
    handle_streaming_run_error: Callable[..., Any]
    logger: Any


async def execute_stream_agent_run(
    input_data: StreamAgentRunInput,
    deps: StreamAgentRunDependencies,
) -> None:
    agent_data = deps.get_agent_data(input_data.agent_id)
    if not agent_data:
        deps.emit_run_error(input_data.channel, f"Agent '{input_data.agent_id}' not found")
        return

    if input_data.ephemeral:
        chat_id = ""
        assistant_msg_id = str(uuid.uuid4())
    else:
        chat_id = deps.ensure_chat_initialized(input_data.chat_id, None)
        parent_id = deps.get_active_leaf_message_id(chat_id)
        if input_data.messages and input_data.messages[-1].role == "user":
            deps.save_user_message(input_data.messages[-1], chat_id, parent_id)
            parent_id = input_data.messages[-1].id
        assistant_msg_id = deps.init_assistant_message(chat_id, parent_id)

    deps.emit_run_start_events(input_data.channel, chat_id, assistant_msg_id)

    try:
        graph_data = agent_data["graph_data"]
        deps.logger.info("[stream_agent] Graph-backed chat — running graph runtime")
        await deps.run_graph_chat_runtime(
            graph_data,
            input_data.messages,
            assistant_msg_id,
            input_data.channel,
            chat_id=chat_id,
            ephemeral=input_data.ephemeral,
            agent_id=input_data.agent_id,
        )
    except Exception as exc:
        await deps.handle_streaming_run_error(
            assistant_msg_id,
            exc,
            input_data.channel,
            chat_id=chat_id,
            ephemeral=input_data.ephemeral,
            label="[stream_agent]",
        )
