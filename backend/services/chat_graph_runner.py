from __future__ import annotations

import asyncio
import json
import logging
import traceback
import types
import uuid
from datetime import datetime
from typing import Any, Awaitable, Callable, Optional

from nodes._types import DataValue, ExecutionResult, NodeEvent
from zynk import Channel

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from .agent_manager import get_agent_manager
from . import stream_broadcaster as broadcaster
from .flow_executor import run_flow
from .graph_executor import build_agent_from_graph
from .tool_registry import get_tool_registry

FlowStreamHandler = Callable[..., Awaitable[None]]

logger = logging.getLogger(__name__)
registry = get_tool_registry()


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def update_chat_model_selection(sess: Any, chat_id: str, model_id: str) -> None:
    config = db.get_chat_agent_config(sess, chat_id) or {}
    if model_id.startswith("agent:"):
        config["agent_id"] = model_id[len("agent:") :]
    else:
        provider, model = parse_model_id(model_id)
        config["provider"] = provider
        config["model_id"] = model
        config.pop("agent_id", None)
    db.update_chat_agent_config(sess, chatId=chat_id, config=config)


def _normalize_instruction_list(raw_instructions: Any) -> list[str]:
    if isinstance(raw_instructions, str):
        stripped = raw_instructions.strip()
        return [stripped] if stripped else []

    if not isinstance(raw_instructions, list):
        return []

    values: list[str] = []
    for item in raw_instructions:
        if not isinstance(item, str):
            continue
        stripped = item.strip()
        if stripped:
            values.append(stripped)
    return values


def _resolve_model_ref(provider: str, model_id: str) -> str:
    provider_clean = provider.strip()
    model_clean = model_id.strip()

    if not model_clean:
        raise ValueError("Model selection is not configured")

    if not provider_clean and ":" in model_clean:
        provider_clean, model_clean = model_clean.split(":", 1)

    if not provider_clean:
        raise ValueError("Model provider is not configured")

    return f"{provider_clean}:{model_clean}"


def _build_canonical_chat_graph(
    *,
    provider: str,
    model_id: str,
    system_prompt: str,
    instructions: list[str],
    name: str,
    description: str,
) -> dict[str, Any]:
    model_ref = _resolve_model_ref(provider, model_id)

    prompt_sections = [
        section for section in [system_prompt.strip(), *instructions] if section
    ]
    agent_data: dict[str, Any] = {
        "name": name,
        "description": description,
        "model": model_ref,
    }
    if prompt_sections:
        agent_data["instructions"] = "\n\n".join(prompt_sections)

    return {
        "nodes": [
            {
                "id": "chat-start-1",
                "type": "chat-start",
                "position": {"x": 120.0, "y": 160.0},
                "data": {"includeUserTools": True},
            },
            {
                "id": "agent-1",
                "type": "agent",
                "position": {"x": 420.0, "y": 160.0},
                "data": agent_data,
            },
        ],
        "edges": [
            {
                "id": "e-chat-start-1-agent-1",
                "source": "chat-start-1",
                "sourceHandle": "output",
                "target": "agent-1",
                "targetHandle": "input",
                "data": {
                    "sourceType": "data",
                    "targetType": "data",
                    "channel": "flow",
                },
            }
        ],
    }


def get_graph_data_for_chat(
    chat_id: str,
    model_id: Optional[str],
) -> dict[str, Any]:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id) or {}
        system_prompt = db.get_system_prompt_setting(sess) or ""

    agent_id: str | None = None

    if model_id:
        if model_id.startswith("agent:"):
            agent_id = model_id[len("agent:") :]
        else:
            provider, parsed_model = parse_model_id(model_id)
            if not provider:
                provider = str(config.get("provider") or "")
            if not parsed_model:
                parsed_model = str(config.get("model_id") or "")
            instructions = _normalize_instruction_list(config.get("instructions"))
            name = str(config.get("name") or "Assistant")
            description = str(
                config.get("description") or "You are a helpful AI assistant."
            )
            return _build_canonical_chat_graph(
                provider=provider,
                model_id=parsed_model,
                system_prompt=system_prompt,
                instructions=instructions,
                name=name,
                description=description,
            )

    if not agent_id and isinstance(config, dict):
        configured_agent = config.get("agent_id")
        if isinstance(configured_agent, str) and configured_agent:
            agent_id = configured_agent

    if agent_id:
        agent_manager = get_agent_manager()
        agent_data = agent_manager.get_agent(agent_id)
        if not agent_data:
            raise ValueError(f"Agent '{agent_id}' not found")
        return agent_data["graph_data"]

    provider = str(config.get("provider") or "")
    configured_model = str(config.get("model_id") or "")
    instructions = _normalize_instruction_list(config.get("instructions"))
    name = str(config.get("name") or "Assistant")
    description = str(config.get("description") or "You are a helpful AI assistant.")

    return _build_canonical_chat_graph(
        provider=provider,
        model_id=configured_model,
        system_prompt=system_prompt,
        instructions=instructions,
        name=name,
        description=description,
    )


def _require_user_message(messages: list[ChatMessage]) -> None:
    if not messages or messages[-1].role != "user":
        raise ValueError("No user message found in request")


def extract_error_message(error_content: str) -> str:
    if not error_content:
        return "Unknown error"

    json_start = error_content.find("{")
    if json_start != -1:
        try:
            data = json.loads(error_content[json_start:])
            if isinstance(data, dict):
                if "error" in data and isinstance(data["error"], dict):
                    return data["error"].get("message", error_content)
                if "message" in data:
                    return data["message"]
        except json.JSONDecodeError:
            pass

    return error_content


class BroadcastingChannel:
    def __init__(self, channel: Any, chat_id: str):
        self._channel = channel
        self._chat_id = chat_id
        self._pending_broadcasts: list[asyncio.Task[Any]] = []

    def send_model(self, event: ChatEvent) -> None:
        self._channel.send_model(event)

        if self._chat_id:
            event_dict = (
                event.model_dump() if hasattr(event, "model_dump") else event.dict()
            )
            self._pending_broadcasts.append(
                asyncio.create_task(
                    broadcaster.broadcast_event(self._chat_id, event_dict)
                )
            )

    async def flush_broadcasts(self) -> None:
        if self._pending_broadcasts:
            await asyncio.gather(*self._pending_broadcasts, return_exceptions=True)
            self._pending_broadcasts.clear()


def save_msg_content(msg_id: str, content: str) -> None:
    with db.db_session() as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


def load_initial_content(msg_id: str) -> list[dict[str, Any]]:
    try:
        with db.db_session() as sess:
            message = sess.get(db.Message, msg_id)
            if not message or not message.content:
                return []

            raw = message.content.strip()
            blocks = (
                json.loads(raw)
                if raw.startswith("[")
                else [{"type": "text", "content": raw}]
            )

            while blocks and blocks[-1].get("type") == "error":
                blocks.pop()

            return blocks
    except Exception as e:
        logger.info(f"[flow_stream] Warning loading initial content: {e}")
        return []


def _pick_text_output(outputs: dict[str, DataValue]) -> DataValue | None:
    if not outputs:
        return None

    data_output = outputs.get("output") or outputs.get("true") or outputs.get("false")
    if data_output is None:
        for value in outputs.values():
            if value.type == "string":
                return value
        return next(iter(outputs.values()))

    raw_value = data_output.value
    if isinstance(raw_value, dict):
        text = (
            raw_value.get("response")
            or raw_value.get("text")
            or raw_value.get("message")
        )
        if text is not None:
            return DataValue(type="string", value=str(text))
        return DataValue(type="string", value=str(raw_value))

    return DataValue(type="string", value=str(raw_value) if raw_value else "")


async def handle_flow_stream(
    graph_data: dict[str, Any],
    agent: Any,
    messages: list[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
    run_flow_impl: Callable[..., Any] | None = None,
) -> None:
    """Run flow runtime and forward NodeEvents as chat protocol events."""
    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch

    def _noop_save(msg_id: str, content: str) -> None:
        del msg_id, content

    save_content = save_msg_content if not ephemeral else _noop_save

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    user_message = ""
    if messages and messages[-1].role == "user":
        content = messages[-1].content
        user_message = content if isinstance(content, str) else json.dumps(content)

    state = types.SimpleNamespace(user_message=user_message)
    context = types.SimpleNamespace(
        run_id=str(uuid.uuid4()),
        chat_id=chat_id,
        state=state,
        tool_registry=registry,
    )

    content_blocks: list[dict[str, Any]] = (
        [] if ephemeral else load_initial_content(assistant_msg_id)
    )
    current_text = ""
    final_output: DataValue | None = None
    runtime_run_flow = run_flow_impl or run_flow

    try:
        async for item in runtime_run_flow(graph_data, agent, context):
            if isinstance(item, NodeEvent):
                if item.event_type == "started":
                    ch.send_model(
                        ChatEvent(
                            event="FlowNodeStarted",
                            content=json.dumps(
                                {"nodeId": item.node_id, "nodeType": item.node_type}
                            ),
                        )
                    )
                elif item.event_type == "progress":
                    token = (item.data or {}).get("token", "")
                    if token:
                        current_text += token
                        ch.send_model(ChatEvent(event="RunContent", content=token))
                        await asyncio.to_thread(
                            save_content,
                            assistant_msg_id,
                            json.dumps(
                                content_blocks
                                + (
                                    [{"type": "text", "content": current_text}]
                                    if current_text
                                    else []
                                )
                            ),
                        )
                elif item.event_type == "completed":
                    ch.send_model(
                        ChatEvent(
                            event="FlowNodeCompleted",
                            content=json.dumps(
                                {"nodeId": item.node_id, "nodeType": item.node_type}
                            ),
                        )
                    )
                elif item.event_type == "error":
                    error_msg = (item.data or {}).get("error", "Unknown node error")
                    content_blocks.append(
                        {
                            "type": "error",
                            "content": f"[{item.node_type}] {error_msg}",
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    )
                    ch.send_model(
                        ChatEvent(
                            event="RunError", content=f"[{item.node_type}] {error_msg}"
                        )
                    )
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, json.dumps(content_blocks)
                    )
            elif isinstance(item, ExecutionResult):
                final_output = _pick_text_output(item.outputs)

        if current_text:
            content_blocks.append({"type": "text", "content": current_text})
        elif final_output and not any(
            block.get("type") == "text" for block in content_blocks
        ):
            text = str(final_output.value) if final_output.value is not None else ""
            if text:
                content_blocks.append({"type": "text", "content": text})
                ch.send_model(ChatEvent(event="RunContent", content=text))

        await asyncio.to_thread(
            save_content, assistant_msg_id, json.dumps(content_blocks)
        )

        if not ephemeral:
            with db.db_session() as sess:
                db.mark_message_complete(sess, assistant_msg_id)

        ch.send_model(ChatEvent(event="RunCompleted"))

        if hasattr(ch, "flush_broadcasts"):
            await ch.flush_broadcasts()

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
    except Exception as e:
        logger.error(f"[flow_stream] Exception: {e}")
        traceback.print_exc()

        if current_text:
            content_blocks.append({"type": "text", "content": current_text})

        error_msg = extract_error_message(str(e))
        content_blocks.append(
            {
                "type": "error",
                "content": error_msg,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
        await asyncio.to_thread(
            save_content, assistant_msg_id, json.dumps(content_blocks)
        )
        ch.send_model(ChatEvent(event="RunError", content=error_msg))

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)


async def run_graph_chat_runtime(
    graph_data: dict[str, Any],
    messages: list[ChatMessage],
    assistant_msg_id: str,
    channel: Channel,
    *,
    chat_id: str,
    ephemeral: bool,
    extra_tool_ids: list[str] | None = None,
    flow_stream_handler: FlowStreamHandler | None = None,
) -> None:
    result = build_agent_from_graph(
        graph_data,
        chat_id=chat_id or None,
        extra_tool_ids=extra_tool_ids,
    )
    _require_user_message(messages)

    handler = flow_stream_handler or handle_flow_stream

    await handler(
        graph_data,
        result.agent,
        messages,
        assistant_msg_id,
        channel,
        chat_id=chat_id,
        ephemeral=ephemeral,
    )
