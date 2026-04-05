from __future__ import annotations

import json

from ..models.chat import ChatMessage

COVALT_ALLOWED_ATTACHMENT_MIME_TYPES = [
    "image/*",
    "audio/*",
    "video/*",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]


def _require_user_message(messages: list[ChatMessage]) -> None:
    if not messages or messages[-1].role != "user":
        raise ValueError("No user message found in request")


def is_allowed_attachment_mime(mime_type: str) -> bool:
    if not mime_type:
        return False

    for prefix, wildcard in [
        ("image/", "image/*"),
        ("audio/", "audio/*"),
        ("video/", "video/*"),
    ]:
        if mime_type.startswith(prefix):
            return wildcard in COVALT_ALLOWED_ATTACHMENT_MIME_TYPES

    return mime_type in COVALT_ALLOWED_ATTACHMENT_MIME_TYPES


def extract_error_message(error_content: str) -> str:
    if not error_content:
        return "Something went wrong. Please try again."

    text = str(error_content).strip()

    json_start = text.find("{")
    if json_start != -1:
        try:
            data = json.loads(text[json_start:])
            if isinstance(data, dict):
                if "error" in data and isinstance(data["error"], dict):
                    msg = data["error"].get("message")
                    if isinstance(msg, str) and msg.strip():
                        text = msg.strip()
                elif "message" in data and isinstance(data["message"], str):
                    text = data["message"].strip()
        except json.JSONDecodeError:
            pass

    first_line = text.splitlines()[0].strip()
    if first_line:
        text = first_line

    if not text:
        return "Something went wrong. Please try again."

    max_len = 1000
    if len(text) > max_len:
        text = text[: max_len - 3].rstrip() + "..."

    return text
