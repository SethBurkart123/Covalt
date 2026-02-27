from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
from agno.models.message import Message
from agno.models.openai.responses import OpenAIResponses
from agno.tools.function import Function

import backend.providers.openai_codex as openai_codex_provider


def test_fetch_codex_models_uses_codex_endpoint_and_parses_reasoning_levels(
    monkeypatch,
) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["client_version"] = request.url.params.get("client_version", "")
        captured["account_id"] = request.headers.get("ChatGPT-Account-Id", "")
        return httpx.Response(
            200,
            json={
                "models": [
                    {
                        "slug": "gpt-5.2-codex",
                        "display_name": "GPT-5.2 Codex",
                        "supported_reasoning_levels": [
                            {"effort": "low", "description": "Fast"},
                            {"effort": "high", "description": "Deep"},
                            {"effort": "xhigh", "description": "Extra deep"},
                        ],
                        "default_reasoning_level": "medium",
                    },
                    {
                        "slug": "o4-mini",
                        "display_name": "O4 Mini",
                    },
                ]
            },
        )

    transport = httpx.MockTransport(handler)

    real_async_client = openai_codex_provider.httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        return real_async_client(transport=transport, timeout=kwargs.get("timeout"))

    monkeypatch.setattr(openai_codex_provider.httpx, "AsyncClient", fake_async_client)
    monkeypatch.setattr(openai_codex_provider, "_get_codex_client_version", lambda: "0.1.0")

    models = asyncio.run(
        openai_codex_provider._fetch_codex_models_from_chatgpt(
            "token-value",
            "acct-123",
        )
    )

    assert captured == {
        "path": "/backend-api/codex/models",
        "client_version": "0.1.0",
        "account_id": "acct-123",
    }
    assert models == [
        {
            "id": "gpt-5.2-codex",
            "name": "GPT-5.2 Codex",
            "supported_reasoning_levels": [
                {"effort": "low", "description": "Fast"},
                {"effort": "high", "description": "Deep"},
                {"effort": "xhigh", "description": "Extra deep"},
            ],
            "default_reasoning_level": "medium",
        }
    ]


def test_get_model_options_uses_reasoning_levels_from_metadata() -> None:
    schema = openai_codex_provider.get_model_options(
        "gpt-5.2-codex",
        {
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "medium"},
                {"effort": "xhigh"},
            ],
            "default_reasoning_level": "medium",
        },
    )

    assert schema["main"] == [
        {
            "key": "reasoning_effort",
            "label": "Reasoning Effort",
            "type": "select",
            "default": "medium",
            "options": [
                {"value": "low", "label": "Low"},
                {"value": "medium", "label": "Medium"},
                {"value": "xhigh", "label": "X-High"},
            ],
        }
    ]
    assert schema["advanced"] == []


def test_map_model_options_maps_reasoning_effort_to_request_params() -> None:
    mapped = openai_codex_provider.resolve_options(
        "gpt-5.2-codex",
        {"reasoning_effort": "xhigh"},
        None,
    )

    assert mapped == {
        "reasoning_effort": "xhigh",
        "reasoning_summary": "auto",
        "include": ["reasoning.encrypted_content"],
    }


def test_get_codex_client_version_uses_minimum_for_old_package_version(
    monkeypatch,
) -> None:
    monkeypatch.setenv("COVALT_CODEX_CLIENT_VERSION", "")
    monkeypatch.setattr(openai_codex_provider, "_read_package_version", lambda: "0.1.0")
    openai_codex_provider._CLIENT_VERSION_CACHE = None

    version = openai_codex_provider._get_codex_client_version()

    assert version == "1.0.0"


def test_get_codex_client_version_prefers_newer_package_version(
    monkeypatch,
) -> None:
    monkeypatch.setenv("COVALT_CODEX_CLIENT_VERSION", "")
    monkeypatch.setattr(openai_codex_provider, "_read_package_version", lambda: "2.3.4")
    openai_codex_provider._CLIENT_VERSION_CACHE = None

    version = openai_codex_provider._get_codex_client_version()

    assert version == "2.3.4"


def test_codex_streams_reasoning_summary_deltas_without_duplicate_completion_summary(
    monkeypatch,
) -> None:
    def fake_base_parse(self, stream_event, assistant_message, tool_use):
        reasoning_content = (
            "final-summary"
            if getattr(stream_event, "type", "") == "response.completed"
            else None
        )
        return SimpleNamespace(reasoning_content=reasoning_content), tool_use

    monkeypatch.setattr(
        OpenAIResponses,
        "_parse_provider_response_delta",
        fake_base_parse,
    )

    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )
    assistant_message = Message(role="assistant", content="")
    tool_use: dict[str, object] = {}

    model._parse_provider_response_delta(
        SimpleNamespace(type="response.created"),
        assistant_message,
        tool_use,
    )
    delta_response, _ = model._parse_provider_response_delta(
        SimpleNamespace(type="response.reasoning_summary_text.delta", delta="abc"),
        assistant_message,
        tool_use,
    )
    assert delta_response.reasoning_content == "abc"

    completed_response, _ = model._parse_provider_response_delta(
        SimpleNamespace(type="response.completed"),
        assistant_message,
        tool_use,
    )
    assert completed_response.reasoning_content is None


def test_codex_keeps_completion_summary_when_no_reasoning_deltas_streamed(
    monkeypatch,
) -> None:
    def fake_base_parse(self, stream_event, assistant_message, tool_use):
        reasoning_content = (
            "final-summary"
            if getattr(stream_event, "type", "") == "response.completed"
            else None
        )
        return SimpleNamespace(reasoning_content=reasoning_content), tool_use

    monkeypatch.setattr(
        OpenAIResponses,
        "_parse_provider_response_delta",
        fake_base_parse,
    )

    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )
    assistant_message = Message(role="assistant", content="")
    tool_use: dict[str, object] = {}

    model._parse_provider_response_delta(
        SimpleNamespace(type="response.created"),
        assistant_message,
        tool_use,
    )
    completed_response, _ = model._parse_provider_response_delta(
        SimpleNamespace(type="response.completed"),
        assistant_message,
        tool_use,
    )
    assert completed_response.reasoning_content == "final-summary"


def test_codex_inserts_line_break_between_reasoning_heading_sections(
    monkeypatch,
) -> None:
    def fake_base_parse(self, stream_event, assistant_message, tool_use):
        return SimpleNamespace(reasoning_content=None), tool_use

    monkeypatch.setattr(
        OpenAIResponses,
        "_parse_provider_response_delta",
        fake_base_parse,
    )

    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )
    assistant_message = Message(role="assistant", content="")
    tool_use: dict[str, object] = {}

    model._parse_provider_response_delta(
        SimpleNamespace(type="response.created"),
        assistant_message,
        tool_use,
    )
    first, _ = model._parse_provider_response_delta(
        SimpleNamespace(
            type="response.reasoning_summary_text.delta",
            delta="Designing section.",
        ),
        assistant_message,
        tool_use,
    )
    assert first.reasoning_content == "Designing section."

    second, _ = model._parse_provider_response_delta(
        SimpleNamespace(
            type="response.reasoning_summary_text.delta",
            delta="**Fetching key verses**\nBody text",
        ),
        assistant_message,
        tool_use,
    )
    assert second.reasoning_content == "\n\n**Fetching key verses**\nBody text"


def test_codex_does_not_insert_line_break_before_closing_bold_chunk(
    monkeypatch,
) -> None:
    def fake_base_parse(self, stream_event, assistant_message, tool_use):
        return SimpleNamespace(reasoning_content=None), tool_use

    monkeypatch.setattr(
        OpenAIResponses,
        "_parse_provider_response_delta",
        fake_base_parse,
    )

    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )
    assistant_message = Message(role="assistant", content="")
    tool_use: dict[str, object] = {}

    model._parse_provider_response_delta(
        SimpleNamespace(type="response.created"),
        assistant_message,
        tool_use,
    )
    first, _ = model._parse_provider_response_delta(
        SimpleNamespace(
            type="response.reasoning_summary_text.delta",
            delta="**Creating Bible study plan",
        ),
        assistant_message,
        tool_use,
    )
    assert first.reasoning_content == "**Creating Bible study plan"

    second, _ = model._parse_provider_response_delta(
        SimpleNamespace(
            type="response.reasoning_summary_text.delta",
            delta="**",
        ),
        assistant_message,
        tool_use,
    )
    assert second.reasoning_content == "**"


def test_function_to_dict_strips_requires_confirmation_globally() -> None:
    def _entrypoint() -> str:
        return "ok"

    function = Function(
        name="example_tool",
        description="Example",
        parameters={"type": "object", "properties": {}},
        entrypoint=_entrypoint,
        skip_entrypoint_processing=True,
        requires_confirmation=True,
    )

    payload = function.to_dict()

    assert "requires_confirmation" not in payload


def test_codex_normalizes_non_fc_tool_call_ids_in_messages() -> None:
    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )

    assistant = Message(
        role="assistant",
        content="",
        tool_calls=[
            {
                "id": "toolu_014SpyXYsCiz5HFQcU2WLAk9",
                "type": "function",
                "function": {
                    "name": "search_docs",
                    "arguments": "{}",
                },
            }
        ],
    )
    tool = Message(
        role="tool",
        tool_call_id="toolu_014SpyXYsCiz5HFQcU2WLAk9",
        content="ok",
    )

    formatted = model._format_messages([assistant, tool])

    function_call = formatted[0]
    function_output = formatted[1]
    assert isinstance(function_call, dict)
    assert isinstance(function_output, dict)
    assert function_call["type"] == "function_call"
    assert function_output["type"] == "function_call_output"
    assert isinstance(function_call.get("id"), str)
    assert function_call["id"].startswith("fc_")
    assert function_call.get("call_id") == function_call["id"]
    assert function_output.get("call_id") == function_call["id"]


def test_codex_preserves_existing_fc_tool_call_ids() -> None:
    model = openai_codex_provider.OpenAICodexResponses(
        id="gpt-5.3-codex",
        api_key="test-key",
        base_url="https://chatgpt.com/backend-api/codex",
    )

    assistant = Message(
        role="assistant",
        content="",
        tool_calls=[
            {
                "id": "fc_existing123",
                "type": "function",
                "function": {
                    "name": "search_docs",
                    "arguments": "{}",
                },
            }
        ],
    )
    tool = Message(role="tool", tool_call_id="fc_existing123", content="ok")

    formatted = model._format_messages([assistant, tool])

    function_call = formatted[0]
    function_output = formatted[1]
    assert isinstance(function_call, dict)
    assert isinstance(function_output, dict)
    assert function_call.get("id") == "fc_existing123"
    assert function_call.get("call_id") == "fc_existing123"
    assert function_output.get("call_id") == "fc_existing123"

