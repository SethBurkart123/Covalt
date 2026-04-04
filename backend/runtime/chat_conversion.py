from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.models.chat import Attachment, ChatMessage
from backend.services.workspace_manager import get_workspace_manager

from .types import RuntimeAttachment, RuntimeMessage, RuntimeToolCall


def runtime_messages_from_chat_messages(
    messages: list[ChatMessage],
    chat_id: str | None,
) -> list[RuntimeMessage]:
    runtime_messages: list[RuntimeMessage] = []
    for message in messages:
        runtime_messages.extend(runtime_message_from_chat_message(message, chat_id))
    return runtime_messages


MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
_ALLOWED_ATTACHMENT_MIME_TYPES = {
    "image/*",
    "audio/*",
    "video/*",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}


def runtime_message_from_chat_message(
    chat_msg: ChatMessage,
    chat_id: str | None = None,
) -> list[RuntimeMessage]:
    if chat_msg.role == "user":
        content = chat_msg.content
        if isinstance(content, list):
            content = json.dumps(content)
        return [
            RuntimeMessage(
                role="user",
                content=content if isinstance(content, str) else str(content),
                attachments=_attachments_for_runtime(chat_id, chat_msg.attachments or []),
            )
        ]

    if chat_msg.role == "assistant":
        return _assistant_runtime_messages(chat_msg)

    return []



def _assistant_runtime_messages(chat_msg: ChatMessage) -> list[RuntimeMessage]:
    content = chat_msg.content
    if isinstance(content, str):
        return [RuntimeMessage(role="assistant", content=content)]
    if not isinstance(content, list):
        return [RuntimeMessage(role="assistant", content=str(content))]

    messages: list[RuntimeMessage] = []
    text_parts: list[str] = []
    for block in _serialize_content_for_runtime(content):
        if not isinstance(block, dict):
            continue

        block_type = block.get("type")
        if block_type == "text":
            text_parts.append(str(block.get("content") or ""))
            continue

        if block_type != "tool_call":
            continue

        if not _should_include_tool_call_block(block):
            continue

        tool_call_id = str(block.get("id") or "")
        tool_name = str(block.get("toolName") or "")
        if not tool_call_id or not tool_name:
            continue

        messages.append(
            RuntimeMessage(
                role="assistant",
                content=" ".join(text_parts) if text_parts else None,
                tool_calls=[
                    RuntimeToolCall(
                        id=tool_call_id,
                        name=tool_name,
                        arguments=_tool_args(block.get("toolArgs")),
                        provider_data=_provider_data(block.get("providerData")),
                    )
                ],
            )
        )
        text_parts = []

        tool_result = block.get("toolResult")
        if tool_result is not None:
            messages.append(
                RuntimeMessage(
                    role="tool",
                    tool_call_id=tool_call_id,
                    content=str(tool_result),
                )
            )

    if text_parts:
        messages.append(RuntimeMessage(role="assistant", content=" ".join(text_parts)))
    return messages if messages else [RuntimeMessage(role="assistant", content="")]



def _should_include_tool_call_block(block: dict[str, Any]) -> bool:
    is_completed = bool(block.get("isCompleted"))
    approval_status = block.get("approvalStatus")
    requires_approval = bool(block.get("requiresApproval"))
    tool_result = block.get("toolResult")
    has_tool_result = tool_result is not None

    if requires_approval and approval_status == "pending":
        return False

    if requires_approval and not has_tool_result:
        return False

    return has_tool_result or (is_completed and approval_status in ("approved", "denied", "timeout"))



def _tool_args(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}



def _provider_data(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) and value else None



def _serialize_content_for_runtime(content: Any) -> Any:
    if not isinstance(content, list):
        return content
    serialized: list[Any] = []
    for block in content:
        if hasattr(block, "model_dump"):
            serialized.append(block.model_dump())
            continue
        if isinstance(block, dict):
            serialized.append(dict(block))
            continue
        serialized.append({"type": "text", "content": str(block)})
    return serialized



def _is_allowed_attachment_mime(mime_type: str) -> bool:
    if not mime_type:
        return False
    for prefix, wildcard in (("image/", "image/*"), ("audio/", "audio/*"), ("video/", "video/*")):
        if mime_type.startswith(prefix):
            return wildcard in _ALLOWED_ATTACHMENT_MIME_TYPES
    return mime_type in _ALLOWED_ATTACHMENT_MIME_TYPES



def _attachments_for_runtime(chat_id: str | None, attachments: list[Attachment]) -> list[RuntimeAttachment]:
    if not chat_id or not attachments:
        return []
    workspace_manager = get_workspace_manager(chat_id)
    runtime_attachments: list[RuntimeAttachment] = []
    for attachment in attachments:
        if attachment.size > MAX_ATTACHMENT_BYTES:
            continue
        if not _is_allowed_attachment_mime(attachment.mimeType):
            continue
        filepath = workspace_manager.workspace_dir / attachment.name
        if not Path(filepath).exists():
            continue
        kind = attachment.type if attachment.type in {"image", "file", "audio", "video"} else "file"
        runtime_attachments.append(
            RuntimeAttachment(kind=kind, path=Path(filepath), name=attachment.name)
        )
    return runtime_attachments
