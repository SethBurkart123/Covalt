"""OpenAI Codex Provider - ChatGPT OAuth Codex models."""

import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from agno.models.message import Message
from agno.models.openai.responses import OpenAIResponses
from openai.types.responses import ResponseReasoningItem

from ..services.provider_oauth_manager import get_provider_oauth_manager
from .options import resolve_common_options


def _get_codex_credentials() -> Dict[str, Any]:
    creds = get_provider_oauth_manager().get_valid_credentials("openai_codex")
    if not creds:
        raise RuntimeError("OpenAI Codex OAuth not connected in Settings.")
    return creds


def _is_codex_model_id(model_id: str) -> bool:
    normalized = model_id.lower()
    return normalized.startswith("gpt-5") or "codex" in normalized


def _extract_system_instructions(messages: Optional[List[Message]]) -> str:
    if not messages:
        return ""

    for message in messages:
        if message.role == "system":
            return message.get_content_string()
    return ""


TOOL_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
CLIENT_VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")

CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models"
MIN_CODEX_CLIENT_VERSION = "1.0.0"
_CLIENT_VERSION_CACHE: str | None = None


def _sanitize_tool_name(name: str, used: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    if not base:
        base = "tool"
    candidate = base
    suffix = 1
    while candidate in used:
        suffix += 1
        candidate = f"{base}_{suffix}"
    used.add(candidate)
    return candidate


class OpenAICodexResponses(OpenAIResponses):
    _codex_tool_name_map: Dict[str, str]
    _codex_tool_name_reverse_map: Dict[str, str]
    _codex_reasoning_summary_streamed: bool = False
    _codex_reasoning_summary_buffer: str = ""

    def get_request_params(
        self,
        messages: Optional[List[Message]] = None,
        response_format: Optional[Any] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Any] = None,
    ) -> Dict[str, Any]:
        params = super().get_request_params(
            messages=messages,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
        )
        params["instructions"] = _extract_system_instructions(messages)
        params["store"] = False
        return params

    def _format_tool_params(
        self, messages: List[Message], tools: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        formatted = super()._format_tool_params(messages=messages, tools=tools)
        name_map: Dict[str, str] = {}
        reverse_map: Dict[str, str] = {}
        used: set[str] = set()

        for tool in formatted:
            if tool.get("type") != "function":
                continue
            name = tool.get("name")
            if not isinstance(name, str):
                continue
            safe = _sanitize_tool_name(name, used)
            if safe != name:
                name_map[safe] = name
                reverse_map[name] = safe
                tool["name"] = safe

        self._codex_tool_name_map = name_map
        self._codex_tool_name_reverse_map = reverse_map
        return formatted

    def _get_safe_tool_name(self, name: str) -> str:
        reverse_map = getattr(self, "_codex_tool_name_reverse_map", None)
        if isinstance(reverse_map, dict) and name in reverse_map:
            return reverse_map[name]
        return name

    def _format_messages(
        self, messages: List[Message], compress_tool_results: bool = False
    ) -> List[Dict[str, Any] | ResponseReasoningItem]:
        sanitized_messages: List[Message] = []
        for message in messages:
            tool_calls = getattr(message, "tool_calls", None)
            if not tool_calls:
                sanitized_messages.append(message)
                continue

            sanitized_tool_calls: List[Dict[str, Any]] = []
            used: set[str] = set()
            for tool_call in tool_calls:
                if (
                    not isinstance(tool_call, dict)
                    or tool_call.get("type") != "function"
                ):
                    sanitized_tool_calls.append(tool_call)
                    continue
                function = tool_call.get("function")
                if not isinstance(function, dict):
                    sanitized_tool_calls.append(tool_call)
                    continue
                name = function.get("name")
                if isinstance(name, str):
                    safe = self._get_safe_tool_name(name)
                    if not TOOL_NAME_PATTERN.match(safe):
                        safe = _sanitize_tool_name(safe, used)
                    if safe != name:
                        remapped = dict(tool_call)
                        remapped_function = dict(function)
                        remapped_function["name"] = safe
                        remapped["function"] = remapped_function
                        sanitized_tool_calls.append(remapped)
                        continue
                sanitized_tool_calls.append(tool_call)

            sanitized_messages.append(
                message.model_copy(update={"tool_calls": sanitized_tool_calls})
            )

        return super()._format_messages(sanitized_messages, compress_tool_results)

    def _map_tool_calls_to_original(
        self, tool_calls: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        name_map = getattr(self, "_codex_tool_name_map", None)
        if not name_map:
            return tool_calls

        mapped: List[Dict[str, Any]] = []
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict) or tool_call.get("type") != "function":
                mapped.append(tool_call)
                continue
            function = tool_call.get("function")
            if not isinstance(function, dict):
                mapped.append(tool_call)
                continue
            name = function.get("name")
            if isinstance(name, str) and name in name_map:
                remapped = dict(tool_call)
                remapped_function = dict(function)
                remapped_function["name"] = name_map[name]
                remapped["function"] = remapped_function
                mapped.append(remapped)
                continue
            mapped.append(tool_call)

        return mapped

    def parse_tool_calls(
        self, tool_calls_data: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        return self._map_tool_calls_to_original(tool_calls_data)

    def _populate_assistant_message(
        self,
        assistant_message: Message,
        provider_response: Any,
    ) -> Message:
        tool_calls = getattr(provider_response, "tool_calls", None)
        if isinstance(tool_calls, list) and tool_calls:
            provider_response.tool_calls = self._map_tool_calls_to_original(tool_calls)
        return super()._populate_assistant_message(assistant_message, provider_response)

    def _parse_provider_response_delta(
        self,
        stream_event: Any,
        assistant_message: Message,
        tool_use: Dict[str, Any],
    ) -> tuple[Any, Dict[str, Any]]:
        model_response, tool_use = super()._parse_provider_response_delta(
            stream_event=stream_event,
            assistant_message=assistant_message,
            tool_use=tool_use,
        )
        event_type = str(getattr(stream_event, "type", "") or "")

        if event_type == "response.created":
            self._codex_reasoning_summary_streamed = False
            self._codex_reasoning_summary_buffer = ""
            return model_response, tool_use

        if event_type == "response.reasoning_summary_text.delta":
            delta = getattr(stream_event, "delta", None)
            if isinstance(delta, str) and delta:
                formatted_delta = self._format_reasoning_summary_delta(
                    self._codex_reasoning_summary_buffer,
                    delta,
                )
                self._codex_reasoning_summary_streamed = True
                self._codex_reasoning_summary_buffer += formatted_delta
                existing = getattr(model_response, "reasoning_content", None)
                if isinstance(existing, str) and existing:
                    model_response.reasoning_content = f"{existing}{formatted_delta}"
                else:
                    model_response.reasoning_content = formatted_delta
            return model_response, tool_use

        if event_type == "response.completed" and self._codex_reasoning_summary_streamed:
            # Base parser also sets the full reasoning summary on completion; skip it if
            # we already streamed the reasoning summary deltas.
            model_response.reasoning_content = None

        return model_response, tool_use

    def _format_reasoning_summary_delta(self, previous: str, delta: str) -> str:
        if not previous:
            return delta
        if delta.startswith(("\n", "\r")):
            return delta

        stripped_delta = delta.lstrip()
        if not stripped_delta:
            return delta

        if previous.endswith("\n"):
            return delta

        if stripped_delta.startswith("**"):
            # Avoid breaking markdown when this chunk is just closing an existing bold span.
            if stripped_delta in {"**", "__"}:
                return delta
            if self._has_unclosed_strong_marker(previous):
                return delta
            return f"\n\n{delta}"

        heading_markers = ("#", "##", "###", "####", "#####", "######")
        if stripped_delta.startswith(heading_markers):
            return f"\n\n{delta}"

        return delta

    def _has_unclosed_strong_marker(self, text: str) -> bool:
        marker_count = len(re.findall(r"(?<!\\)\*\*", text))
        return marker_count % 2 == 1


def _build_codex_headers(access_token: str, account_id: str | None) -> Dict[str, str]:
    client_version = _get_codex_client_version()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "OpenAI-Beta": "responses=experimental",
        "originator": "agno",
        "User-Agent": f"Agno Desktop/{client_version}",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id
    return headers


async def _fetch_codex_models_from_chatgpt(
    access_token: str,
    account_id: str | None,
) -> List[Dict[str, Any]]:
    headers = _build_codex_headers(access_token, account_id)
    client_version = _get_codex_client_version()
    url = f"{CODEX_MODELS_URL}?client_version={client_version}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, headers=headers)
            if not response.is_success:
                return []
            payload = response.json()
    except Exception as exc:
        print(f"[openai_codex] Failed to fetch models: {exc}")
        return []

    models: List[Dict[str, Any]] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("models"), list):
            models = payload.get("models", [])
        elif isinstance(payload.get("data"), list):
            models = payload.get("data", [])
        elif isinstance(payload.get("items"), list):
            models = payload.get("items", [])
    elif isinstance(payload, list):
        models = payload

    results: List[Dict[str, Any]] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        model_id = model.get("id") or model.get("model") or model.get("slug")
        if not isinstance(model_id, str) or not _is_codex_model_id(model_id):
            continue
        name = (
            model.get("name")
            or model.get("title")
            or model.get("display_name")
            or model_id
        )
        model_info: Dict[str, Any] = {"id": model_id, "name": name}

        reasoning_levels = _extract_reasoning_levels(model)
        if reasoning_levels:
            model_info["supported_reasoning_levels"] = reasoning_levels

        default_reasoning = model.get("default_reasoning_level")
        if isinstance(default_reasoning, str) and default_reasoning:
            model_info["default_reasoning_level"] = default_reasoning

        results.append(model_info)

    return results


def _extract_reasoning_levels(model: Dict[str, Any]) -> List[Dict[str, str]]:
    parsed = _parse_reasoning_levels(model.get("supported_reasoning_levels"))
    if parsed:
        return parsed
    return _parse_reasoning_levels(model.get("supported_reasoning_efforts"))


def _parse_reasoning_levels(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []

    parsed: List[Dict[str, str]] = []
    seen_efforts: set[str] = set()
    for item in value:
        effort: str | None = None
        description: str | None = None

        if isinstance(item, dict):
            effort_value = item.get("effort") or item.get("value")
            if isinstance(effort_value, str):
                effort = effort_value.strip().lower()
            description_value = item.get("description")
            if isinstance(description_value, str) and description_value.strip():
                description = description_value.strip()
        elif isinstance(item, str):
            effort = item.strip().lower()

        if not effort or effort in seen_efforts:
            continue

        seen_efforts.add(effort)
        level_info: Dict[str, str] = {"effort": effort}
        if description:
            level_info["description"] = description
        parsed.append(level_info)

    return parsed


def _normalize_client_version(raw_version: Any) -> str | None:
    if not isinstance(raw_version, str):
        return None
    version = raw_version.strip()
    if CLIENT_VERSION_PATTERN.match(version):
        return version
    return None


def _parse_client_version(version: str) -> tuple[int, int, int] | None:
    normalized = _normalize_client_version(version)
    if not normalized:
        return None
    major, minor, patch = normalized.split(".")
    return int(major), int(minor), int(patch)


def _max_client_version(left: str, right: str) -> str:
    left_parsed = _parse_client_version(left)
    right_parsed = _parse_client_version(right)
    if not left_parsed:
        return right
    if not right_parsed:
        return left
    return left if left_parsed >= right_parsed else right


def _read_package_version() -> str | None:
    package_json = Path(__file__).resolve().parents[2] / "package.json"
    try:
        payload = json.loads(package_json.read_text(encoding="utf-8"))
    except Exception:
        return None
    return _normalize_client_version(payload.get("version"))


def _get_codex_client_version() -> str:
    global _CLIENT_VERSION_CACHE
    if _CLIENT_VERSION_CACHE:
        return _CLIENT_VERSION_CACHE

    env_version = _normalize_client_version(os.getenv("AGNO_CODEX_CLIENT_VERSION"))
    if env_version:
        _CLIENT_VERSION_CACHE = env_version
        return _CLIENT_VERSION_CACHE

    package_version = _read_package_version()
    if package_version:
        _CLIENT_VERSION_CACHE = _max_client_version(
            package_version, MIN_CODEX_CLIENT_VERSION
        )
        return _CLIENT_VERSION_CACHE

    today = date.today()
    dated_version = f"{today.year}.{today.month}.{today.day}"
    _CLIENT_VERSION_CACHE = _max_client_version(
        dated_version, MIN_CODEX_CLIENT_VERSION
    )
    return _CLIENT_VERSION_CACHE


def get_openai_codex_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> OpenAIResponses:
    creds = _get_codex_credentials()
    access_token = creds.get("access_token")
    account_id = None
    extra = creds.get("extra")
    if isinstance(extra, dict):
        account_id = extra.get("accountId")
    if not access_token or not account_id:
        raise RuntimeError("OpenAI Codex OAuth credentials are incomplete.")

    headers = _build_codex_headers(access_token, account_id)

    return OpenAICodexResponses(
        id=model_id,
        api_key=access_token,
        base_url="https://chatgpt.com/backend-api/codex",
        default_headers=headers,
        store=False,
        **provider_options,
    )


def resolve_options(
    model_id: str,
    model_options: Dict[str, Any] | None,
    node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    _ = model_id
    options = model_options or {}
    resolved = resolve_common_options(model_options, node_params)

    reasoning_effort = options.get("reasoning_effort")
    if isinstance(reasoning_effort, str) and reasoning_effort:
        resolved["reasoning_effort"] = reasoning_effort
        resolved["reasoning_summary"] = "auto"
        resolved["include"] = ["reasoning.encrypted_content"]

    return resolved


async def fetch_models() -> List[Dict[str, Any]]:
    creds = get_provider_oauth_manager().get_valid_credentials("openai_codex")
    if not creds:
        return []
    access_token = creds.get("access_token")
    extra = creds.get("extra")
    account_id = extra.get("accountId") if isinstance(extra, dict) else None
    if not access_token:
        return []

    models = await _fetch_codex_models_from_chatgpt(access_token, account_id)
    if models:
        return models

    return []


def get_model_options(
    model_id: str,
    model_metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    _ = model_id
    metadata = model_metadata or {}
    reasoning_levels = _parse_reasoning_levels(
        metadata.get("supported_reasoning_levels")
    )

    if not reasoning_levels:
        return {"main": [], "advanced": []}

    options = [
        {
            "value": level["effort"],
            "label": _format_reasoning_level_label(level["effort"]),
        }
        for level in reasoning_levels
    ]
    allowed_efforts = {option["value"] for option in options}

    default_effort = metadata.get("default_reasoning_level")
    if not isinstance(default_effort, str) or default_effort not in allowed_efforts:
        default_effort = options[0]["value"]

    return {
        "main": [
            {
                "key": "reasoning_effort",
                "label": "Reasoning Effort",
                "type": "select",
                "default": default_effort,
                "options": options,
            }
        ],
        "advanced": [],
    }


def _format_reasoning_level_label(level: str) -> str:
    normalized = level.strip().lower()
    if normalized == "xhigh":
        return "X-High"
    if normalized == "none":
        return "Off"
    return normalized.replace("_", " ").title()


async def test_connection() -> tuple[bool, str | None]:
    creds = get_provider_oauth_manager().get_valid_credentials("openai_codex")
    if not creds:
        return False, "OAuth not connected"
    return True, None
