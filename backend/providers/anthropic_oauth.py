"""Anthropic OAuth Provider - Claude models via OAuth token."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Dict, Iterator, List, Optional, Union

import httpx

from agno.exceptions import ModelProviderError
from agno.models.base import Model
from agno.models.message import Message
from agno.models.metrics import Metrics
from agno.models.response import ModelResponse

from ..services.models_dev import fetch_models_dev_provider
from ..services.provider_oauth_manager import get_provider_oauth_manager

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_OAUTH_BETA = (
    "claude-code-20250219,oauth-2025-04-20,"
    "fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14"
)
CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude."
CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.2 (external, cli)"
TOOL_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
DEFAULT_CACHE_CONTROL = {"type": "ephemeral"}


def _get_anthropic_credentials() -> Dict[str, Any]:
    creds = get_provider_oauth_manager().get_valid_credentials("anthropic_oauth")
    if not creds:
        raise RuntimeError("Anthropic OAuth not connected in Settings.")
    return creds


def _normalize_tool_call_id(tool_call_id: str) -> str:
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in tool_call_id)[:64]


def _sanitize_tool_name(name: str, used: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    if not base:
        base = "tool"
    base = base[:128]
    candidate = base
    suffix = 1
    while candidate in used:
        suffix += 1
        suffix_str = f"_{suffix}"
        trimmed = base[: max(1, 128 - len(suffix_str))]
        candidate = f"{trimmed}{suffix_str}"
    used.add(candidate)
    return candidate


def _log_usage(event_type: str, usage: Dict[str, Any]) -> None:
    print(f"[anthropic_oauth] {event_type} usage={usage}")


def _parse_tool_arguments(arguments: Any) -> Dict[str, Any]:
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except Exception:
            return {}
        if isinstance(parsed, dict):
            return parsed
        return {"value": parsed}
    if isinstance(arguments, dict):
        return arguments
    return {}


def _build_system_blocks(
    messages: List[Message], cache_control: Optional[Dict[str, str]]
) -> Optional[List[Dict[str, Any]]]:
    blocks: List[Dict[str, Any]] = [{"type": "text", "text": CLAUDE_CODE_SYSTEM}]
    for message in messages:
        if message.role != "system":
            continue
        text = message.get_content_string()
        if text:
            blocks.append({"type": "text", "text": text})
    if cache_control:
        for block in blocks:
            block["cache_control"] = cache_control
    return blocks if blocks else None


def _build_tools(
    tools: Optional[List[Dict[str, Any]]],
) -> tuple[Optional[List[Dict[str, Any]]], Dict[str, str], Dict[str, str]]:
    if not tools:
        return None, {}, {}
    results: List[Dict[str, Any]] = []
    name_map: Dict[str, str] = {}
    reverse_map: Dict[str, str] = {}
    used: set[str] = set()
    for tool in tools:
        if tool.get("type") != "function":
            continue
        func = tool.get("function")
        if not isinstance(func, dict):
            continue
        name = func.get("name")
        if not isinstance(name, str) or not name:
            continue
        safe_name = _sanitize_tool_name(name, used)
        if safe_name != name:
            name_map[safe_name] = name
            reverse_map[name] = safe_name
        schema = func.get("parameters") or {"type": "object", "properties": {}}
        tool_def: Dict[str, Any] = {"name": safe_name, "input_schema": schema}
        description = func.get("description")
        if isinstance(description, str) and description:
            tool_def["description"] = description
        results.append(tool_def)
    return (results or None), name_map, reverse_map


def _convert_messages(
    messages: List[Message],
    safe_tool_name: Optional[Callable[[str], str]] = None,
) -> List[Dict[str, Any]]:
    params: List[Dict[str, Any]] = []
    i = 0
    while i < len(messages):
        message = messages[i]
        if message.role == "system":
            i += 1
            continue
        if message.role == "user":
            content = message.get_content_string()
            if content:
                params.append({"role": "user", "content": content})
            i += 1
            continue
        if message.role == "assistant":
            blocks: List[Dict[str, Any]] = []
            text = message.get_content_string()
            if text:
                blocks.append({"type": "text", "text": text})
            if message.tool_calls:
                for tool_call in message.tool_calls:
                    if not isinstance(tool_call, dict):
                        continue
                    function = tool_call.get("function") or {}
                    if not isinstance(function, dict):
                        continue
                    name = function.get("name")
                    if not isinstance(name, str) or not name:
                        continue
                    if safe_tool_name is not None:
                        name = safe_tool_name(name)
                    tool_call_id = (
                        tool_call.get("id")
                        or tool_call.get("call_id")
                        or f"call_{int(time.time() * 1000)}"
                    )
                    tool_call_id = _normalize_tool_call_id(str(tool_call_id))
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": tool_call_id,
                            "name": name,
                            "input": _parse_tool_arguments(function.get("arguments")),
                        }
                    )
            if blocks:
                params.append({"role": "assistant", "content": blocks})
            i += 1
            continue
        if message.role == "tool":
            tool_results: List[Dict[str, Any]] = []
            while i < len(messages) and messages[i].role == "tool":
                tool_msg = messages[i]
                tool_id = tool_msg.tool_call_id or ""
                tool_use_id = _normalize_tool_call_id(str(tool_id)) if tool_id else ""
                if tool_use_id:
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": tool_msg.get_content_string(),
                            "is_error": bool(tool_msg.tool_call_error),
                        }
                    )
                i += 1
            if tool_results:
                params.append({"role": "user", "content": tool_results})
            continue
        i += 1
    return params


def _apply_cache_control(
    params: List[Dict[str, Any]], cache_control: Optional[Dict[str, str]]
) -> None:
    if not cache_control:
        return
    for message in reversed(params):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, list) and content:
            last_block = content[-1]
            if isinstance(last_block, dict):
                last_block["cache_control"] = cache_control
            return
        if isinstance(content, str) and content:
            message["content"] = [
                {"type": "text", "text": content, "cache_control": cache_control}
            ]
            return


def _build_metrics(usage: Dict[str, Any]) -> Metrics:
    input_tokens = usage.get("input_tokens") or 0
    output_tokens = usage.get("output_tokens") or 0
    cache_read = usage.get("cache_read_input_tokens") or 0
    cache_write = usage.get("cache_creation_input_tokens") or 0
    total_tokens = input_tokens + output_tokens + cache_read + cache_write
    return Metrics(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cache_read_tokens=cache_read,
        cache_write_tokens=cache_write,
    )


@dataclass
class AnthropicOAuthModel(Model):
    id: str
    name: Optional[str] = None
    provider: Optional[str] = None
    access_token: Optional[str] = None
    base_url: str = "https://api.anthropic.com"
    max_tokens: int = 4096
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    cache_retention: str = "short"
    _tool_name_map: Optional[Dict[str, str]] = None
    _tool_name_reverse_map: Optional[Dict[str, str]] = None

    def _get_safe_tool_name(self, name: str) -> str:
        reverse_map = self._tool_name_reverse_map or {}
        if name in reverse_map:
            return reverse_map[name]
        if TOOL_NAME_PATTERN.match(name):
            return name
        used = set(reverse_map.values())
        safe = _sanitize_tool_name(name, used)
        reverse_map[name] = safe
        name_map = self._tool_name_map or {}
        name_map[safe] = name
        self._tool_name_reverse_map = reverse_map
        self._tool_name_map = name_map
        return safe

    def _get_original_tool_name(self, name: str) -> str:
        name_map = self._tool_name_map or {}
        return name_map.get(name, name)

    def _map_tool_choice(
        self, tool_choice: Optional[Union[str, Dict[str, Any]]]
    ) -> Optional[Dict[str, Any]]:
        if tool_choice is None:
            return None
        if isinstance(tool_choice, str):
            if tool_choice in ("auto", "any", "none"):
                return {"type": tool_choice}
            return {"type": "auto"}
        if isinstance(tool_choice, dict):
            name = tool_choice.get("name")
            if not isinstance(name, str) or not name:
                name = tool_choice.get("function", {}).get("name")
            if isinstance(name, str) and name:
                return {"type": "tool", "name": self._get_safe_tool_name(name)}
        return None

    def invoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        messages: List[Message] = kwargs.get("messages") or []
        response_format = kwargs.get("response_format")
        tools = kwargs.get("tools")
        tool_choice = kwargs.get("tool_choice")
        return self._invoke_sync(messages, response_format, tools, tool_choice)

    async def ainvoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        messages: List[Message] = kwargs.get("messages") or []
        response_format = kwargs.get("response_format")
        tools = kwargs.get("tools")
        tool_choice = kwargs.get("tool_choice")
        return await self._invoke_async(messages, response_format, tools, tool_choice)

    def invoke_stream(self, *args: Any, **kwargs: Any) -> Iterator[ModelResponse]:
        messages: List[Message] = kwargs.get("messages") or []
        response_format = kwargs.get("response_format")
        tools = kwargs.get("tools")
        tool_choice = kwargs.get("tool_choice")
        yield from self._invoke_stream_sync(
            messages, response_format, tools, tool_choice
        )

    async def ainvoke_stream(
        self, *args: Any, **kwargs: Any
    ) -> AsyncIterator[ModelResponse]:
        messages: List[Message] = kwargs.get("messages") or []
        response_format = kwargs.get("response_format")
        tools = kwargs.get("tools")
        tool_choice = kwargs.get("tool_choice")
        async for chunk in self._invoke_stream_async(
            messages, response_format, tools, tool_choice
        ):
            yield chunk

    def _parse_provider_response(self, response: Any, **kwargs: Any) -> ModelResponse:
        return response if isinstance(response, ModelResponse) else ModelResponse()

    def _parse_provider_response_delta(self, response: Any) -> ModelResponse:
        return response if isinstance(response, ModelResponse) else ModelResponse()

    def _build_headers(self) -> Dict[str, str]:
        if not self.access_token:
            raise ModelProviderError(
                message="Missing access token for Anthropic OAuth",
                status_code=401,
                model_name=self.name,
                model_id=self.id,
            )
        cache_control = self._get_cache_control()
        betas = [
            "claude-code-20250219",
            "oauth-2025-04-20",
            "fine-grained-tool-streaming-2025-05-14",
            "interleaved-thinking-2025-05-14",
        ]
        if cache_control:
            betas.append("prompt-caching-2024-07-31")
        return {
            "Authorization": f"Bearer {self.access_token}",
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": ",".join(betas),
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": CLAUDE_CODE_USER_AGENT,
            "x-app": "cli",
        }

    def _get_cache_control(self) -> Optional[Dict[str, str]]:
        retention = (self.cache_retention or "").lower()
        if retention in ("", "none"):
            return None
        if retention == "long" and "api.anthropic.com" in self.base_url:
            return {"type": "ephemeral", "ttl": "1h"}
        return dict(DEFAULT_CACHE_CONTROL)

    def _build_request(
        self,
        messages: List[Message],
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
        *,
        stream: bool,
    ) -> Dict[str, Any]:
        tool_defs, name_map, reverse_map = _build_tools(tools)
        self._tool_name_map = name_map
        self._tool_name_reverse_map = reverse_map
        cache_control = self._get_cache_control()

        payload: Dict[str, Any] = {
            "model": self.id,
            "messages": _convert_messages(messages, self._get_safe_tool_name),
            "max_tokens": self.max_tokens,
            "stream": stream,
        }

        system_blocks = _build_system_blocks(messages, cache_control)
        if system_blocks:
            payload["system"] = system_blocks

        _apply_cache_control(payload["messages"], cache_control)

        if tool_defs:
            payload["tools"] = tool_defs

        choice = self._map_tool_choice(tool_choice)
        if choice:
            payload["tool_choice"] = choice

        if self.temperature is not None:
            payload["temperature"] = self.temperature
        if self.top_p is not None:
            payload["top_p"] = self.top_p

        return payload

    def _invoke_sync(
        self,
        messages: List[Message],
        response_format: Any,
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> ModelResponse:
        content = ""
        reasoning = ""
        tool_calls: List[Dict[str, Any]] = []
        metrics: Optional[Metrics] = None
        for delta in self._invoke_stream_sync(
            messages, response_format, tools, tool_choice
        ):
            if delta.content:
                content += str(delta.content)
            if delta.reasoning_content:
                reasoning += str(delta.reasoning_content)
            if delta.tool_calls:
                tool_calls.extend(delta.tool_calls)
            if delta.response_usage:
                metrics = delta.response_usage

        response = ModelResponse(role="assistant", content=content)
        if reasoning:
            response.reasoning_content = reasoning
        if tool_calls:
            response.tool_calls = tool_calls
        if metrics:
            response.response_usage = metrics
        return response

    async def _invoke_async(
        self,
        messages: List[Message],
        response_format: Any,
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> ModelResponse:
        content = ""
        reasoning = ""
        tool_calls: List[Dict[str, Any]] = []
        metrics: Optional[Metrics] = None
        async for delta in self._invoke_stream_async(
            messages, response_format, tools, tool_choice
        ):
            if delta.content:
                content += str(delta.content)
            if delta.reasoning_content:
                reasoning += str(delta.reasoning_content)
            if delta.tool_calls:
                tool_calls.extend(delta.tool_calls)
            if delta.response_usage:
                metrics = delta.response_usage

        response = ModelResponse(role="assistant", content=content)
        if reasoning:
            response.reasoning_content = reasoning
        if tool_calls:
            response.tool_calls = tool_calls
        if metrics:
            response.response_usage = metrics
        return response

    def _invoke_stream_sync(
        self,
        messages: List[Message],
        response_format: Any,
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> Iterator[ModelResponse]:
        request_body = self._build_request(messages, tools, tool_choice, stream=True)
        headers = self._build_headers()
        url = f"{self.base_url.rstrip('/')}/v1/messages"
        tool_state: Dict[int, Dict[str, Any]] = {}

        with httpx.Client(timeout=60.0) as client:
            with client.stream(
                "POST", url, json=request_body, headers=headers
            ) as response:
                if response.status_code != 200:
                    raise ModelProviderError(
                        message=response.text,
                        status_code=response.status_code,
                        model_name=self.name,
                        model_id=self.id,
                    )
                for line in response.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        data = json.loads(payload)
                    except Exception:
                        continue
                    for delta in self._parse_stream_event(data, tool_state):
                        yield delta

    async def _invoke_stream_async(
        self,
        messages: List[Message],
        response_format: Any,
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> AsyncIterator[ModelResponse]:
        request_body = self._build_request(messages, tools, tool_choice, stream=True)
        headers = self._build_headers()
        url = f"{self.base_url.rstrip('/')}/v1/messages"
        tool_state: Dict[int, Dict[str, Any]] = {}

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", url, json=request_body, headers=headers
            ) as response:
                if response.status_code != 200:
                    error_text = (await response.aread()).decode(
                        "utf-8", errors="replace"
                    )
                    raise ModelProviderError(
                        message=error_text,
                        status_code=response.status_code,
                        model_name=self.name,
                        model_id=self.id,
                    )
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        data = json.loads(payload)
                    except Exception:
                        continue
                    for delta in self._parse_stream_event(data, tool_state):
                        yield delta

    def _parse_stream_event(
        self, event: Dict[str, Any], tool_state: Dict[int, Dict[str, Any]]
    ) -> Iterator[ModelResponse]:
        event_type = event.get("type")
        if event_type == "message_start":
            usage = (event.get("message") or {}).get("usage")
            message_id = (event.get("message") or {}).get("id")
            if message_id:
                print(f"[anthropic_oauth] message_start id={message_id}")
            if isinstance(usage, dict):
                _log_usage("message_start", usage)
                yield ModelResponse(response_usage=_build_metrics(usage))
            return

        if event_type == "message_delta":
            usage = event.get("usage")
            if isinstance(usage, dict):
                _log_usage("message_delta", usage)
                yield ModelResponse(response_usage=_build_metrics(usage))
            return

        if event_type == "content_block_start":
            block = event.get("content_block") or {}
            block_type = block.get("type")
            if block_type == "tool_use":
                index = event.get("index")
                if isinstance(index, int):
                    tool_id = block.get("id") or f"toolu_{int(time.time() * 1000)}"
                    tool_state[index] = {
                        "id": _normalize_tool_call_id(str(tool_id)),
                        "name": block.get("name"),
                        "json": "",
                        "has_delta": False,
                        "input": block.get("input"),
                    }
            return

        if event_type == "content_block_delta":
            delta = event.get("delta") or {}
            delta_type = delta.get("type")
            if delta_type == "text_delta":
                text = delta.get("text")
                if text:
                    yield ModelResponse(content=text)
            elif delta_type == "thinking_delta":
                thinking = delta.get("thinking")
                if thinking:
                    yield ModelResponse(reasoning_content=thinking)
            elif delta_type == "input_json_delta":
                index = event.get("index")
                if isinstance(index, int) and index in tool_state:
                    tool_state[index]["has_delta"] = True
                    tool_state[index]["json"] += delta.get("partial_json", "")
            return

        if event_type == "content_block_stop":
            index = event.get("index")
            if isinstance(index, int) and index in tool_state:
                state = tool_state.pop(index)
                name = state.get("name")
                if isinstance(name, str):
                    name = self._get_original_tool_name(name)
                parsed_args: Dict[str, Any] = {}
                if state.get("has_delta"):
                    args_json = state.get("json") or "{}"
                    try:
                        parsed_args = json.loads(args_json)
                    except Exception:
                        parsed_args = {}
                else:
                    input_payload = state.get("input")
                    if isinstance(input_payload, dict):
                        parsed_args = input_payload
                tool_calls = [
                    {
                        "id": state.get("id"),
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": json.dumps(parsed_args),
                        },
                    }
                ]
                yield ModelResponse(tool_calls=tool_calls)
            return


def get_anthropic_oauth_model(model_id: str, **kwargs: Any) -> Model:
    creds = _get_anthropic_credentials()
    access_token = creds.get("access_token")
    if not access_token:
        raise RuntimeError("Anthropic OAuth credentials are incomplete.")

    max_tokens = kwargs.pop("max_tokens", None) or kwargs.pop("max_output_tokens", None)
    model = AnthropicOAuthModel(
        id=model_id,
        access_token=access_token,
        max_tokens=max_tokens or 4096,
    )
    for key, value in kwargs.items():
        if hasattr(model, key):
            setattr(model, key, value)
    return model


async def fetch_models() -> List[Dict[str, str]]:
    creds = get_provider_oauth_manager().get_valid_credentials("anthropic_oauth")
    if not creds:
        return []
    access_token = creds.get("access_token")
    if not access_token:
        return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "anthropic-version": ANTHROPIC_VERSION,
                    "anthropic-beta": ANTHROPIC_OAUTH_BETA,
                },
            )
            if response.is_success:
                models = response.json().get("data", [])
                return [
                    {"id": m["id"], "name": m.get("display_name", m["id"])}
                    for m in models
                    if isinstance(m, dict) and isinstance(m.get("id"), str)
                ]
    except Exception as exc:
        print(f"[anthropic_oauth] Failed to fetch models: {exc}")

    return await fetch_models_dev_provider(
        "anthropic",
        predicate=lambda _id, info: info.get("tool_call") is True,
    )


async def test_connection() -> tuple[bool, str | None]:
    creds = get_provider_oauth_manager().get_valid_credentials("anthropic_oauth")
    if not creds:
        return False, "OAuth not connected"
    return True, None
