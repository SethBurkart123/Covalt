"""OpenAI Codex Provider - ChatGPT OAuth Codex models."""

import re
from typing import Any, Dict, List, Optional

import httpx
from agno.models.message import Message
from agno.models.openai.responses import OpenAIResponses
from openai.types.responses import ResponseReasoningItem

from ..services.models_dev import fetch_models_dev_provider
from ..services.provider_oauth_manager import get_provider_oauth_manager


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


def _build_codex_headers(access_token: str, account_id: str | None) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "OpenAI-Beta": "responses=experimental",
        "originator": "agno",
        "User-Agent": "Agno Desktop",
    }
    if account_id:
        headers["chatgpt-account-id"] = account_id
    return headers


async def _fetch_codex_models_from_chatgpt(
    access_token: str, account_id: str | None
) -> List[Dict[str, str]]:
    headers = _build_codex_headers(access_token, account_id)
    url = "https://chatgpt.com/backend-api/models"

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
        if isinstance(payload.get("data"), list):
            models = payload.get("data", [])
        elif isinstance(payload.get("models"), list):
            models = payload.get("models", [])
        elif isinstance(payload.get("items"), list):
            models = payload.get("items", [])
    elif isinstance(payload, list):
        models = payload

    results: List[Dict[str, str]] = []
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
        results.append({"id": model_id, "name": name})

    return results


def get_openai_codex_model(model_id: str, **kwargs: Any) -> OpenAIResponses:
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
        **kwargs,
    )


async def fetch_models() -> List[Dict[str, str]]:
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

    return await fetch_models_dev_provider(
        "openai",
        predicate=lambda model_id, info: info.get("tool_call") is True
        and _is_codex_model_id(model_id),
    )


async def test_connection() -> tuple[bool, str | None]:
    creds = get_provider_oauth_manager().get_valid_credentials("openai_codex")
    if not creds:
        return False, "OAuth not connected"
    return True, None
