"""GitHub Copilot Provider - OAuth-based Copilot models."""

import json
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Union

import httpx
from agno.models.litellm import LiteLLM
from agno.models.base import Model
from agno.models.message import Message
from agno.models.metrics import Metrics
from agno.models.openai.responses import OpenAIResponses
from agno.models.response import ModelResponse
from agno.exceptions import ModelProviderError
from openai.types.responses import ResponseReasoningItem

from ..services.models_dev import fetch_models_dev_provider
from ..services.provider_oauth_manager import get_provider_oauth_manager
from ..services.tool_name_sanitizer import ToolNameSanitizer

COPILOT_HEADERS = {
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
}

COPILOT_CLAUDE4_PATTERN = re.compile(r"^claude-(haiku|sonnet|opus)-4([.\-]|$)")
OPENAI_TOOL_NAME_CHARS = "a-zA-Z0-9_.-"
ANTHROPIC_TOOL_NAME_CHARS = "a-zA-Z0-9_-"
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_BETA = "interleaved-thinking-2025-05-14"


class CopilotOpenAIResponses(OpenAIResponses):
    _tool_name_sanitizer: Optional[ToolNameSanitizer] = None

    def get_request_params(
        self,
        messages: Optional[List[Message]] = None,
        response_format: Optional[Any] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Any] = None,
    ) -> Dict[str, Any]:
        self.store = False
        params = super().get_request_params(
            messages=messages,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
        )
        params.pop("previous_response_id", None)
        params["store"] = False
        sanitizer = self._tool_name_sanitizer
        if sanitizer and "tool_choice" in params:
            params["tool_choice"] = sanitizer.sanitize_tool_choice(
                params["tool_choice"]
            )
        return params

    def _format_tool_params(
        self, messages: List[Message], tools: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        formatted = super()._format_tool_params(messages=messages, tools=tools)
        if not formatted:
            self._tool_name_sanitizer = None
            return formatted
        sanitizer = ToolNameSanitizer(OPENAI_TOOL_NAME_CHARS)
        self._tool_name_sanitizer = sanitizer
        return sanitizer.sanitize_tool_definitions(formatted) or []

    def _format_messages(
        self, messages: List[Message], compress_tool_results: bool = False
    ) -> List[Dict[str, Any] | ResponseReasoningItem]:
        sanitizer = self._tool_name_sanitizer or ToolNameSanitizer(
            OPENAI_TOOL_NAME_CHARS
        )
        self._tool_name_sanitizer = sanitizer
        sanitized_messages: List[Message] = []

        for message in messages:
            tool_calls = getattr(message, "tool_calls", None)
            name = message.name or message.tool_name
            if tool_calls:
                sanitized_tool_calls = sanitizer.sanitize_tool_calls(tool_calls)
                if sanitized_tool_calls != tool_calls:
                    message = message.model_copy(
                        update={"tool_calls": sanitized_tool_calls}
                    )

            if message.role == "tool" and isinstance(name, str) and name:
                safe_name = sanitizer.map_original_to_safe(name)
                if safe_name != name:
                    message = message.model_copy(update={"name": safe_name})

            sanitized_messages.append(message)

        return super()._format_messages(sanitized_messages, compress_tool_results)

    def parse_tool_calls(
        self, tool_calls_data: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        sanitizer = self._tool_name_sanitizer
        if not sanitizer:
            return tool_calls_data
        return sanitizer.restore_tool_calls(tool_calls_data)

    def _populate_assistant_message(
        self,
        assistant_message: Message,
        provider_response: Any,
    ) -> Message:
        tool_calls = getattr(provider_response, "tool_calls", None)
        sanitizer = self._tool_name_sanitizer
        if sanitizer and isinstance(tool_calls, list) and tool_calls:
            provider_response.tool_calls = sanitizer.restore_tool_calls(tool_calls)
        return super()._populate_assistant_message(assistant_message, provider_response)


class CopilotLiteLLM(LiteLLM):
    tool_name_chars: str = OPENAI_TOOL_NAME_CHARS
    _tool_name_sanitizer: Optional[ToolNameSanitizer] = None

    def get_request_params(
        self, tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        if tools:
            sanitizer = ToolNameSanitizer(self.tool_name_chars)
            sanitized_tools = sanitizer.sanitize_tool_definitions(tools)
            self._tool_name_sanitizer = sanitizer
            return super().get_request_params(tools=sanitized_tools)
        self._tool_name_sanitizer = None
        return super().get_request_params(tools=tools)

    def _format_messages(
        self, messages: List[Message], compress_tool_results: bool = False
    ) -> List[Dict[str, Any]]:
        formatted = super()._format_messages(messages, compress_tool_results)
        sanitizer = self._tool_name_sanitizer
        if not sanitizer:
            return formatted

        for msg in formatted:
            if not isinstance(msg, dict):
                continue
            tool_calls = msg.get("tool_calls")
            if isinstance(tool_calls, list):
                msg["tool_calls"] = sanitizer.sanitize_tool_calls(tool_calls)
            if msg.get("role") == "tool" and isinstance(msg.get("name"), str):
                msg["name"] = sanitizer.map_original_to_safe(msg["name"])

        return formatted

    def _parse_provider_response(self, response: Any, **kwargs) -> Any:
        model_response = super()._parse_provider_response(response, **kwargs)
        sanitizer = self._tool_name_sanitizer
        if sanitizer and model_response.tool_calls:
            model_response.tool_calls = sanitizer.restore_tool_calls(
                model_response.tool_calls
            )
        return model_response


def _normalize_tool_call_id(tool_call_id: str) -> str:
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in tool_call_id)[:64]


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


def _build_system_blocks(messages: List[Message]) -> Optional[List[Dict[str, Any]]]:
    blocks: List[Dict[str, Any]] = []
    for message in messages:
        if message.role != "system":
            continue
        text = message.get_content_string()
        if text:
            blocks.append({"type": "text", "text": text})
    return blocks or None


@dataclass
class CopilotAnthropicModel(Model):
    id: str
    name: Optional[str] = None
    provider: Optional[str] = None
    access_token: Optional[str] = None
    base_url: str = "https://api.individual.githubcopilot.com"
    max_tokens: int = 4096
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    _tool_name_sanitizer: Optional[ToolNameSanitizer] = None

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
                message="Missing access token for GitHub Copilot",
                status_code=401,
                model_name=self.name,
                model_id=self.id,
            )
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": ANTHROPIC_BETA,
            "content-type": "application/json",
            "accept": "application/json",
            **COPILOT_HEADERS,
        }
        return headers

    def _build_tools(
        self, tools: Optional[List[Dict[str, Any]]]
    ) -> Optional[List[Dict[str, Any]]]:
        if not tools:
            return None
        sanitizer = self._tool_name_sanitizer or ToolNameSanitizer(
            ANTHROPIC_TOOL_NAME_CHARS
        )
        self._tool_name_sanitizer = sanitizer
        results: List[Dict[str, Any]] = []
        for tool in tools:
            if tool.get("type") != "function":
                continue
            func = tool.get("function")
            if not isinstance(func, dict):
                continue
            name = func.get("name")
            if not isinstance(name, str) or not name:
                continue
            safe_name = sanitizer.map_original_to_safe(name)
            schema = func.get("parameters") or {"type": "object", "properties": {}}
            tool_def: Dict[str, Any] = {"name": safe_name, "input_schema": schema}
            description = func.get("description")
            if isinstance(description, str) and description:
                tool_def["description"] = description
            results.append(tool_def)
        return results or None

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
                sanitizer = self._tool_name_sanitizer or ToolNameSanitizer(
                    ANTHROPIC_TOOL_NAME_CHARS
                )
                self._tool_name_sanitizer = sanitizer
                return {"type": "tool", "name": sanitizer.map_original_to_safe(name)}
        return None

    def _convert_messages(self, messages: List[Message]) -> List[Dict[str, Any]]:
        sanitizer = self._tool_name_sanitizer or ToolNameSanitizer(
            ANTHROPIC_TOOL_NAME_CHARS
        )
        self._tool_name_sanitizer = sanitizer
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
                        safe_name = sanitizer.map_original_to_safe(name)
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
                                "name": safe_name,
                                "input": _parse_tool_arguments(
                                    function.get("arguments")
                                ),
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
                    tool_use_id = (
                        _normalize_tool_call_id(str(tool_id)) if tool_id else ""
                    )
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

    def _build_metrics(self, usage: Dict[str, Any]) -> Metrics:
        input_tokens = usage.get("input_tokens") or 0
        output_tokens = usage.get("output_tokens") or 0
        total_tokens = input_tokens + output_tokens
        return Metrics(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )

    def _build_request(
        self,
        messages: List[Message],
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
        *,
        stream: bool,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": self.id,
            "messages": self._convert_messages(messages),
            "max_tokens": self.max_tokens,
            "stream": stream,
        }

        system_blocks = _build_system_blocks(messages)
        if system_blocks:
            payload["system"] = system_blocks

        tool_defs = self._build_tools(tools)
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

    def _build_messages_url(self) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/v1"):
            return f"{base}/messages"
        return f"{base}/v1/messages"

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
        url = self._build_messages_url()
        tool_state: Dict[int, Dict[str, Any]] = {}

        with httpx.Client(timeout=60.0) as client:
            with client.stream(
                "POST", url, json=request_body, headers=headers
            ) as response:
                if response.status_code != 200:
                    error_text = response.read().decode("utf-8", errors="replace")
                    raise ModelProviderError(
                        message=error_text,
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
        url = self._build_messages_url()
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
            if isinstance(usage, dict):
                yield ModelResponse(response_usage=self._build_metrics(usage))
            return

        if event_type == "message_delta":
            usage = event.get("usage")
            if isinstance(usage, dict):
                yield ModelResponse(response_usage=self._build_metrics(usage))
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
                sanitizer = self._tool_name_sanitizer or ToolNameSanitizer(
                    ANTHROPIC_TOOL_NAME_CHARS
                )
                if isinstance(name, str):
                    name = sanitizer.map_safe_to_original(name)
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


def _get_copilot_credentials() -> Dict[str, Any]:
    creds = get_provider_oauth_manager().get_valid_credentials("github_copilot")
    if not creds:
        raise RuntimeError("GitHub Copilot OAuth not connected in Settings.")
    return creds


def _get_copilot_base_url(creds: Dict[str, Any]) -> str:
    extra = creds.get("extra")
    if isinstance(extra, dict) and extra.get("baseUrl"):
        return extra["baseUrl"]
    return "https://api.individual.githubcopilot.com"


def _resolve_copilot_api(model_id: str) -> str:
    if COPILOT_CLAUDE4_PATTERN.match(model_id):
        return "anthropic-messages"
    if model_id.startswith("gpt-5") or model_id.startswith("oswe"):
        return "openai-responses"
    return "openai-completions"


async def _fetch_copilot_models_from_api(
    base_url: str, access_token: str
) -> List[Dict[str, str]]:
    base = base_url.rstrip("/")
    urls = [f"{base}/models", f"{base}/v1/models"]
    headers = {
        "Authorization": f"Bearer {access_token}",
        **COPILOT_HEADERS,
    }

    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(url, headers=headers)
                if not response.is_success:
                    continue
                payload = response.json()
        except Exception:
            continue

        models: List[Dict[str, Any]] = []
        if isinstance(payload, dict):
            if isinstance(payload.get("data"), list):
                models = payload.get("data", [])
            elif isinstance(payload.get("models"), list):
                models = payload.get("models", [])
        elif isinstance(payload, list):
            models = payload

        results: List[Dict[str, str]] = []
        for model in models:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id") or model.get("model") or model.get("slug")
            if not isinstance(model_id, str):
                continue
            name = (
                model.get("name")
                or model.get("title")
                or model.get("display_name")
                or model_id
            )
            results.append({"id": model_id, "name": name})

        if results:
            return results

    return []


def get_github_copilot_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> Any:
    creds = _get_copilot_credentials()
    token = creds.get("access_token")
    if not token:
        raise RuntimeError("GitHub Copilot OAuth credentials are incomplete.")

    api = _resolve_copilot_api(model_id)
    base_url = _get_copilot_base_url(creds)
    if api == "openai-responses":
        return CopilotOpenAIResponses(
            id=model_id,
            api_key=token,
            base_url=base_url,
            default_headers=COPILOT_HEADERS,
            **provider_options,
        )

    if api == "anthropic-messages":
        max_tokens = provider_options.pop("max_tokens", None) or provider_options.pop(
            "max_output_tokens", None
        )
        model = CopilotAnthropicModel(
            id=model_id,
            access_token=token,
            base_url=base_url,
            max_tokens=max_tokens or 4096,
        )
        for key, value in provider_options.items():
            if hasattr(model, key):
                setattr(model, key, value)
        return model

    return CopilotLiteLLM(
        id=f"openai/{model_id}",
        api_key=token,
        api_base=base_url,
        extra_headers=COPILOT_HEADERS,
        **provider_options,
    )


async def fetch_models() -> List[Dict[str, str]]:
    creds = get_provider_oauth_manager().get_valid_credentials("github_copilot")
    if not creds:
        return []
    access_token = creds.get("access_token")
    if not access_token:
        return []

    base_url = _get_copilot_base_url(creds)
    models = await _fetch_copilot_models_from_api(base_url, access_token)
    if models:
        return models

    return await fetch_models_dev_provider(
        "github-copilot",
        predicate=lambda model_id, info: info.get("tool_call") is True
        and info.get("status") != "deprecated",
    )


async def test_connection() -> tuple[bool, str | None]:
    creds = get_provider_oauth_manager().get_valid_credentials("github_copilot")
    if not creds:
        return False, "OAuth not connected"
    return True, None
