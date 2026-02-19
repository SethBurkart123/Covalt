"""Google Cloud Code Assist shared model implementation."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Union

import httpx

from agno.exceptions import ModelProviderError
from agno.models.base import Model
from agno.models.message import Message
from agno.models.metrics import Metrics
from agno.models.response import ModelResponse


DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com"
ANTIGRAVITY_ENDPOINT_FALLBACKS = (
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    DEFAULT_ENDPOINT,
)
DEFAULT_ANTIGRAVITY_VERSION = "1.15.8"
ANTIGRAVITY_USER_AGENT = f"antigravity/{DEFAULT_ANTIGRAVITY_VERSION} darwin/arm64"
ANTIGRAVITY_API_CLIENT = "google-cloud-sdk vscode_cloudshelleditor/0.1"


def _requires_tool_call_id(model_id: str) -> bool:
    return model_id.startswith("claude-") or model_id.startswith("gpt-oss-")


def _normalize_tool_call_id(tool_call_id: str) -> str:
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in tool_call_id)[:64]


def _build_function_declarations(
    tools: Optional[List[Dict[str, Any]]], use_parameters: bool
) -> Optional[List[Dict[str, Any]]]:
    if not tools:
        return None
    declarations: List[Dict[str, Any]] = []
    for tool in tools:
        func = tool.get("function") if isinstance(tool, dict) else None
        if not isinstance(func, dict):
            continue
        params = func.get("parameters") or {}
        if use_parameters:
            declarations.append(
                {
                    "name": func.get("name"),
                    "description": func.get("description"),
                    "parameters": params,
                }
            )
        else:
            declarations.append(
                {
                    "name": func.get("name"),
                    "description": func.get("description"),
                    "parametersJsonSchema": params,
                }
            )
    if not declarations:
        return None
    return [{"functionDeclarations": declarations}]


def _map_tool_choice(choice: Optional[Union[str, Dict[str, Any]]]) -> Optional[str]:
    if choice is None:
        return None
    if isinstance(choice, str):
        if choice == "none":
            return "NONE"
        if choice == "any":
            return "ANY"
        return "AUTO"
    return "AUTO"


def _extract_system_prompt(messages: List[Message]) -> Optional[str]:
    for message in messages:
        if message.role == "system" and isinstance(message.content, str):
            return message.content
    return None


def _convert_messages(model_id: str, messages: List[Message]) -> List[Dict[str, Any]]:
    contents: List[Dict[str, Any]] = []
    for message in messages:
        if message.role == "system":
            continue
        if message.role == "user":
            contents.append(
                {
                    "role": "user",
                    "parts": [{"text": message.get_content_string()}],
                }
            )
            continue
        if message.role == "assistant":
            parts: List[Dict[str, Any]] = []
            if message.content:
                parts.append({"text": message.get_content_string()})
            if message.tool_calls:
                for tool_call in message.tool_calls:
                    function = tool_call.get("function", {})
                    name = function.get("name")
                    args = function.get("arguments")
                    provider_data = tool_call.get("providerData")
                    thought_signature = (
                        provider_data.get("thoughtSignature")
                        if isinstance(provider_data, dict)
                        else None
                    )
                    if isinstance(args, str):
                        try:
                            parsed_args = json.loads(args)
                        except Exception:
                            parsed_args = {}
                    else:
                        parsed_args = args or {}
                    tool_call_id = (
                        tool_call.get("id") or f"call_{int(time.time() * 1000)}"
                    )
                    if _requires_tool_call_id(model_id):
                        tool_call_id = _normalize_tool_call_id(tool_call_id)
                    part: Dict[str, Any] = {
                        "functionCall": {
                            "name": name,
                            "args": parsed_args,
                            **(
                                {"id": tool_call_id}
                                if _requires_tool_call_id(model_id)
                                else {}
                            ),
                        }
                    }
                    if thought_signature:
                        part["thoughtSignature"] = thought_signature
                    parts.append(part)
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue
        if message.role == "tool":
            tool_name = message.name or message.tool_name
            tool_call_id = message.tool_call_id
            if tool_call_id and _requires_tool_call_id(model_id):
                tool_call_id = _normalize_tool_call_id(tool_call_id)
            response_value = message.get_content_string()
            response_payload = (
                {"error": response_value}
                if message.tool_call_error
                else {"output": response_value}
            )
            response_part = {
                "functionResponse": {
                    "name": tool_name,
                    "response": response_payload,
                    **({"id": tool_call_id} if tool_call_id else {}),
                }
            }
            if (
                contents
                and contents[-1].get("role") == "user"
                and any(
                    "functionResponse" in part
                    for part in (contents[-1].get("parts") or [])
                )
            ):
                contents[-1]["parts"].append(response_part)
            else:
                contents.append({"role": "user", "parts": [response_part]})
    return contents


@dataclass
class CloudCodeAssistModel(Model):
    id: str
    name: Optional[str] = None
    provider: Optional[str] = None
    access_token: Optional[str] = None
    project_id: Optional[str] = None
    base_url: str = "https://cloudcode-pa.googleapis.com"
    is_antigravity: bool = False

    def _get_endpoints(self) -> List[str]:
        endpoints: List[str] = []
        base = (self.base_url or "").rstrip("/")
        if base:
            endpoints.append(base)
        if self.is_antigravity:
            for endpoint in ANTIGRAVITY_ENDPOINT_FALLBACKS:
                if endpoint not in endpoints:
                    endpoints.append(endpoint)
        if not endpoints:
            endpoints.append(DEFAULT_ENDPOINT)
        return endpoints

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
        request_body = self._build_request(messages, tools, tool_choice)
        headers = self._build_headers()
        last_error: ModelProviderError | None = None

        with httpx.Client(timeout=60.0) as client:
            for endpoint in self._get_endpoints():
                url = f"{endpoint}/v1internal:streamGenerateContent?alt=sse"
                with client.stream(
                    "POST", url, json=request_body, headers=headers
                ) as response:
                    if response.status_code != 200:
                        error_text = response.read().decode("utf-8", errors="replace")
                        error = ModelProviderError(
                            message=error_text,
                            status_code=response.status_code,
                            model_name=self.name,
                            model_id=self.id,
                        )
                        last_error = error
                        if self.is_antigravity and response.status_code == 404:
                            continue
                        raise error
                    for line in response.iter_lines():
                        if not line:
                            continue
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            data = json.loads(payload)
                        except Exception:
                            continue
                        for delta in self._parse_stream_chunk(data):
                            yield delta
                    return

        if last_error is not None:
            raise last_error

    async def _invoke_stream_async(
        self,
        messages: List[Message],
        response_format: Any,
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> AsyncIterator[ModelResponse]:
        request_body = self._build_request(messages, tools, tool_choice)
        headers = self._build_headers()
        last_error: ModelProviderError | None = None

        async with httpx.AsyncClient(timeout=60.0) as client:
            for endpoint in self._get_endpoints():
                url = f"{endpoint}/v1internal:streamGenerateContent?alt=sse"
                async with client.stream(
                    "POST", url, json=request_body, headers=headers
                ) as response:
                    if response.status_code != 200:
                        error_text = (await response.aread()).decode(
                            "utf-8", errors="replace"
                        )
                        error = ModelProviderError(
                            message=error_text,
                            status_code=response.status_code,
                            model_name=self.name,
                            model_id=self.id,
                        )
                        last_error = error
                        if self.is_antigravity and response.status_code == 404:
                            continue
                        raise error
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            data = json.loads(payload)
                        except Exception:
                            continue
                        for delta in self._parse_stream_chunk(data):
                            yield delta
                    return

        if last_error is not None:
            raise last_error

    def _build_request(
        self,
        messages: List[Message],
        tools: Optional[List[Dict[str, Any]]],
        tool_choice: Optional[Union[str, Dict[str, Any]]],
    ) -> Dict[str, Any]:
        if not self.project_id:
            raise ModelProviderError(
                message="Missing projectId for Cloud Code Assist",
                status_code=401,
                model_name=self.name,
                model_id=self.id,
            )
        contents = _convert_messages(self.id, messages)
        use_parameters = self.id.startswith("claude-")
        tool_decls = _build_function_declarations(tools, use_parameters)
        tool_choice_mode = _map_tool_choice(tool_choice)

        request: Dict[str, Any] = {
            "contents": contents,
        }
        system_prompt = _extract_system_prompt(messages)
        if system_prompt:
            request["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tool_decls:
            request["tools"] = tool_decls
        if tool_choice_mode:
            request["toolConfig"] = {
                "functionCallingConfig": {"mode": tool_choice_mode}
            }

        request_id = f"agno-{int(time.time() * 1000)}"
        if self.is_antigravity:
            request_id = f"agent-{int(time.time() * 1000)}-{uuid.uuid4().hex[:9]}"
        payload: Dict[str, Any] = {
            "project": self.project_id,
            "model": self.id,
            "request": request,
            "userAgent": "antigravity" if self.is_antigravity else "agno",
            "requestId": request_id,
        }
        if self.is_antigravity:
            payload["requestType"] = "agent"
        return payload

    def _build_headers(self) -> Dict[str, str]:
        if not self.access_token:
            raise ModelProviderError(
                message="Missing access token for Cloud Code Assist",
                status_code=401,
                model_name=self.name,
                model_id=self.id,
            )
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
            "X-Goog-Api-Client": "gl-node/22.17.0",
            "Client-Metadata": json.dumps(
                {
                    "ideType": "IDE_UNSPECIFIED",
                    "platform": "PLATFORM_UNSPECIFIED",
                    "pluginType": "GEMINI",
                }
            ),
        }
        if self.is_antigravity:
            headers["User-Agent"] = ANTIGRAVITY_USER_AGENT
            headers["X-Goog-Api-Client"] = ANTIGRAVITY_API_CLIENT
        return headers

    def _parse_stream_chunk(self, chunk: Dict[str, Any]) -> Iterator[ModelResponse]:
        error = chunk.get("error")
        if isinstance(error, dict) and error:
            message = error.get("message") or json.dumps(error)
            status_code = error.get("code")
            error_kwargs = {
                "message": str(message),
                "model_name": self.name,
                "model_id": self.id,
            }
            if isinstance(status_code, int):
                error_kwargs["status_code"] = status_code
            raise ModelProviderError(**error_kwargs)
        response = chunk.get("response") or {}
        if isinstance(response, dict) and response.get("error"):
            error = response.get("error")
            message = error.get("message") if isinstance(error, dict) else error
            status_code = error.get("code") if isinstance(error, dict) else None
            error_kwargs = {
                "message": str(message) if message is not None else json.dumps(error),
                "model_name": self.name,
                "model_id": self.id,
            }
            if isinstance(status_code, int):
                error_kwargs["status_code"] = status_code
            raise ModelProviderError(**error_kwargs)
        candidates = response.get("candidates") or []
        usage = response.get("usageMetadata") or {}
        if usage:
            metrics = Metrics(
                input_tokens=max(
                    0,
                    (usage.get("promptTokenCount") or 0)
                    - (usage.get("cachedContentTokenCount") or 0),
                ),
                output_tokens=(usage.get("candidatesTokenCount") or 0)
                + (usage.get("thoughtsTokenCount") or 0),
                total_tokens=usage.get("totalTokenCount") or 0,
                cache_read_tokens=usage.get("cachedContentTokenCount") or 0,
                cache_write_tokens=0,
                reasoning_tokens=usage.get("thoughtsTokenCount") or 0,
            )
            yield ModelResponse(response_usage=metrics)

        if not candidates:
            return
        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        for part in parts:
            if "text" in part:
                if part.get("thought"):
                    yield ModelResponse(reasoning_content=part.get("text", ""))
                else:
                    yield ModelResponse(content=part.get("text", ""))
            if "functionCall" in part:
                call = part.get("functionCall") or {}
                thought_signature = part.get("thoughtSignature")
                tool_call_id = call.get("id") or f"call_{int(time.time() * 1000)}"
                if _requires_tool_call_id(self.id):
                    tool_call_id = _normalize_tool_call_id(tool_call_id)
                tool_calls = [
                    {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": call.get("name"),
                            "arguments": json.dumps(call.get("args") or {}),
                        },
                        **(
                            {"providerData": {"thoughtSignature": thought_signature}}
                            if thought_signature
                            else {}
                        ),
                    }
                ]
                yield ModelResponse(tool_calls=tool_calls)
