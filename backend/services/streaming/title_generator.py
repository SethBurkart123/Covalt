from __future__ import annotations

import json
import logging
import os
import re

from ... import db
from ...runtime import (
    AgentConfig,
    ContentDelta,
    RunCompleted,
    RunError,
    RuntimeMessage,
    get_adapter,
)

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


def _is_e2e_test_mode_enabled() -> bool:
    return os.getenv("COVALT_E2E_TESTS") == "1"


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


def _extract_json_title(text: str) -> str | None:
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


def _normalize_title(text: str) -> str | None:
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


def _fallback_title_from_message(user_content: str) -> str | None:
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
) -> str | None:
    if not provider or not model_id:
        return None

    from ..models.model_factory import get_model

    async def _run() -> str | None:
        model = get_model(provider, model_id)
        adapter = get_adapter()
        handle = adapter.create_agent(
            AgentConfig(
                model=model,
                instructions=[instructions],
                tools=[],
                name="Title Generator",
            )
        )

        streamed_text_parts: list[str] = []
        final_content: str | None = None
        had_run_error = False

        async for event in handle.run(
            [RuntimeMessage(role="user", content=user_content)],
            add_history_to_context=False,
        ):
            if isinstance(event, RunError):
                had_run_error = True
                continue
            if isinstance(event, ContentDelta) and event.text:
                streamed_text_parts.append(event.text)
                continue
            if isinstance(event, RunCompleted):
                final_content = event.content

        if had_run_error:
            return None
        if final_content is not None:
            return final_content
        if streamed_text_parts:
            return "".join(streamed_text_parts)
        return None

    return asyncio.run(_run())


def generate_title_for_chat(chat_id: str) -> str | None:
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

            if _is_e2e_test_mode_enabled():
                candidates = [
                    (provider, model_id)
                    for provider, model_id in candidates
                    if provider != "e2e"
                ]

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
