from __future__ import annotations

from typing import Optional

import json
import logging
import re

from agno.agent import Agent, Message

from .. import db
from .runtime_events import (
    EVENT_RUN_CANCELLED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
)

ERROR_RUN_EVENTS = {EVENT_RUN_ERROR, EVENT_RUN_CANCELLED}
TITLE_CONTENT_EVENTS = {EVENT_RUN_CONTENT, EVENT_RUN_COMPLETED}

DEFAULT_PROMPT = (
    "Generate a brief, descriptive title (max 6 words) for this conversation "
    "based on the user's message. Return only the title, nothing else."
)
MAX_TITLE_CHARS = 100
MAX_TITLE_WORDS = 12

SPECIAL_TOKEN_RE = re.compile(r"<\|[^>]+\|>")
THINK_TAG_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"```[\s\S]*?```")
TITLE_PREFIX_RE = re.compile(r"^(title|chat title)\s*[:\-]\s*", re.IGNORECASE)
FINAL_PREFIX_RE = re.compile(r"^(final|answer)\s*[:\-]\s*", re.IGNORECASE)
REASONING_PREFIXES = (
    "analysis",
    "reasoning",
    "thought",
    "thinking",
    "chain of thought",
)

logger = logging.getLogger(__name__)


def _get_event_name(chunk: object) -> Optional[str]:
    event = getattr(chunk, "event", None)
    return event if isinstance(event, str) and event else None


def _run_completed_successfully(run_output: object) -> bool:
    status = getattr(run_output, "status", None)
    if status is None:
        return True

    status_value = getattr(status, "value", status)
    if not isinstance(status_value, str):
        return False

    return status_value.lower() == "completed"


def _build_title_instructions(prompt_template: str, user_content: str) -> str:
    if not prompt_template:
        return DEFAULT_PROMPT
    if "{{ message }}" in prompt_template:
        return prompt_template.replace("{{ message }}", user_content)
    return prompt_template


def _sanitize_raw_title(text: str) -> str:
    cleaned = CODE_FENCE_RE.sub("", text)
    cleaned = SPECIAL_TOKEN_RE.sub("", cleaned)
    cleaned = THINK_TAG_RE.sub("", cleaned)
    cleaned = cleaned.replace("\u0000", "")
    return cleaned.strip()


def _extract_json_title(text: str) -> Optional[str]:
    stripped = text.strip()
    if not stripped.startswith("{"):
        return None
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    for key in ("title", "chat_title", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _pick_title_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""

    for line in lines:
        lowered = line.lower()
        if any(lowered.startswith(prefix) for prefix in REASONING_PREFIXES):
            continue
        if FINAL_PREFIX_RE.match(line):
            return FINAL_PREFIX_RE.sub("", line).strip()

    for line in lines:
        if TITLE_PREFIX_RE.match(line):
            return TITLE_PREFIX_RE.sub("", line).strip()

    return lines[-1] if len(lines) > 1 else lines[0]


def _normalize_title(text: str) -> Optional[str]:
    if not text:
        return None
    title = TITLE_PREFIX_RE.sub("", text).strip().strip("\"'").strip()
    title = re.sub(r"\s+", " ", title)
    if not title:
        return None
    words = title.split()
    if len(words) > MAX_TITLE_WORDS:
        title = " ".join(words[:MAX_TITLE_WORDS]).strip()
    if len(title) > MAX_TITLE_CHARS:
        title = title[:MAX_TITLE_CHARS].strip()
    return title or None


def _fallback_title_from_message(user_content: str) -> Optional[str]:
    cleaned = _sanitize_raw_title(user_content)
    if not cleaned:
        return None
    line = cleaned.splitlines()[0].strip() if cleaned.splitlines() else cleaned
    return _normalize_title(line)


def _run_title_request(
    provider: str,
    model_id: str,
    instructions: str,
    user_content: str,
) -> Optional[str]:
    if not provider or not model_id:
        return None

    from .model_factory import get_model

    model = get_model(provider, model_id)
    agent = Agent(model=model, instructions=[instructions], tools=[], stream=True)
    response_stream = agent.run(
        input=[Message(role="user", content=user_content)],
        stream=True,
        stream_events=False,
        yield_run_output=True,
    )

    final_response = None
    streamed_text_parts: list[str] = []
    had_run_error = False

    for chunk in response_stream:
        event_name = _get_event_name(chunk)

        if event_name in ERROR_RUN_EVENTS:
            had_run_error = True
            continue

        if hasattr(chunk, "messages"):
            final_response = chunk
            continue

        if event_name and event_name not in TITLE_CONTENT_EVENTS:
            continue

        content = getattr(chunk, "content", None)
        if isinstance(content, str) and content:
            streamed_text_parts.append(content)

    if had_run_error:
        return None

    if final_response is not None and not _run_completed_successfully(final_response):
        return None

    title_raw: Optional[str] = None
    if final_response is not None and getattr(final_response, "messages", None):
        last_msg = final_response.messages[-1]
        if last_msg and hasattr(last_msg, "content"):
            title_raw = str(last_msg.content)

    if title_raw is None and streamed_text_parts:
        title_raw = "".join(streamed_text_parts)

    return title_raw


def generate_title_for_chat(chat_id: str) -> Optional[str]:
    try:
        with db.db_session() as sess:
            settings = db.get_auto_title_settings(sess)

            if not settings.get("enabled", True):
                return None

            messages = db.get_chat_messages(sess, chat_id)
            if not messages:
                return None

            first_user_msg = None
            for msg in messages:
                if msg.get("role") == "user":
                    first_user_msg = msg
                    break

            if not first_user_msg:
                return None

            user_content = first_user_msg.get("content", "")
            if isinstance(user_content, list):
                user_content = json.dumps(user_content)

            prompt_template = settings.get("prompt", DEFAULT_PROMPT)
            instructions = _build_title_instructions(prompt_template, str(user_content))
            model_mode = settings.get("model_mode", "current")

            candidates: list[tuple[str, str]] = []

            if model_mode == "current":
                config = db.get_chat_agent_config(sess, chat_id) or {}
                if not config:
                    config = db.get_default_agent_config()
                provider = str(config.get("provider") or "")
                model_id = str(config.get("model_id") or "")
                if provider and model_id and provider != "agent":
                    candidates.append((provider, model_id))

            fallback_provider = str(settings.get("provider") or "openai")
            fallback_model = str(settings.get("model_id") or "gpt-4o-mini")
            if fallback_provider and fallback_model:
                fallback = (fallback_provider, fallback_model)
                if fallback not in candidates:
                    candidates.append(fallback)

            title = None

            for provider, model_id in candidates:
                try:
                    title_raw = _run_title_request(
                        provider, model_id, instructions, str(user_content)
                    )
                except Exception as exc:
                    logger.warning(
                        "[title_generator] Title run failed for %s:%s: %s",
                        provider,
                        model_id,
                        exc,
                    )
                    title_raw = None

                if not title_raw:
                    continue

                json_title = _extract_json_title(title_raw)
                raw_title = json_title or title_raw
                cleaned = _sanitize_raw_title(raw_title)
                candidate_line = _pick_title_line(cleaned)
                title = _normalize_title(candidate_line)

                if title:
                    break

            if not title:
                title = _fallback_title_from_message(str(user_content))
            if not title:
                return None

            return title

    except Exception as e:
        logger.warning("[title_generator] Error: %s", e)
        return None
