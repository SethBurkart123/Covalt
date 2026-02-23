from __future__ import annotations

import json
from typing import Any, Dict, List

from agno.models.base import Model
from agno.models.response import ModelResponse


class StaticToolModel(Model):
    def __init__(self, model_id: str, scenario: str) -> None:
        super().__init__(id=model_id, name="E2E", provider="e2e")
        self._scenario = scenario

    def _build_tool_call(self) -> Dict[str, Any]:
        if self._scenario == "toolset":
            tool_name = "artifact-tools:write_artifact"
            args = {
                "title": "E2E Markdown Table",
                "content": "| Item | Qty |\n| --- | --- |\n| Apples | 5 |",
            }
        elif self._scenario == "approval":
            tool_name = "e2e_requires_approval"
            args = {"text": "E2E approval"}
        else:
            tool_name = "e2e_echo"
            args = {"text": "E2E echo"}

        return {
            "id": f"e2e-{self._scenario}-call-1",
            "type": "function",
            "function": {
                "name": tool_name,
                "arguments": json.dumps(args),
            },
        }

    def _build_response(self, messages: List[Any] | None) -> ModelResponse:
        if messages:
            for msg in messages:
                role = getattr(msg, "role", None)
                if role == self.tool_message_role:
                    return ModelResponse(role="assistant", content="done", tool_calls=[])

        return ModelResponse(
            role="assistant",
            content="",
            tool_calls=[self._build_tool_call()],
        )

    def invoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return self._build_response(kwargs.get("messages"))

    async def ainvoke(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return self._build_response(kwargs.get("messages"))

    def invoke_stream(self, *args: Any, **kwargs: Any):
        yield self._build_response(kwargs.get("messages"))

    async def ainvoke_stream(self, *args: Any, **kwargs: Any):
        yield self._build_response(kwargs.get("messages"))

    def _parse_provider_response(self, response: Any, **kwargs: Any) -> ModelResponse:
        return response if isinstance(response, ModelResponse) else ModelResponse()

    def _parse_provider_response_delta(self, response: Any) -> ModelResponse:
        return response if isinstance(response, ModelResponse) else ModelResponse()


def get_e2e_model(model_id: str, provider_options: Dict[str, Any]) -> Model:
    scenario = model_id.strip() if model_id.strip() else "toolset"
    return StaticToolModel(model_id=model_id, scenario=scenario)


async def fetch_models() -> List[Dict[str, Any]]:
    return [
        {"id": "toolset", "name": "E2E Toolset Tool"},
        {"id": "builtin", "name": "E2E Builtin Tool"},
        {"id": "approval", "name": "E2E Approval Tool"},
    ]


def get_model_options(_model_id: str, _model_metadata: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {"main": [], "advanced": []}


def resolve_options(
    _model_id: str,
    model_options: Dict[str, Any] | None,
    _node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    return model_options or {}


def test_connection() -> tuple[bool, str | None]:
    return True, None
