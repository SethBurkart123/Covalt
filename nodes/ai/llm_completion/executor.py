"""LLM Completion node — single LLM call, prompt in, streamed text out."""

from __future__ import annotations

from typing import Any

from backend.services.model_factory import get_model
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent


def resolve_model(model_str: str) -> Any:
    if ":" not in model_str:
        raise ValueError(
            f"Invalid model format '{model_str}' — expected 'provider:model_id'"
        )
    provider, model_id = model_str.split(":", 1)
    return get_model(provider, model_id)


class LlmCompletionExecutor:
    node_type = "llm-completion"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ):
        prompt = inputs.get("prompt", DataValue("string", "")).value or data.get(
            "prompt", ""
        )
        model_str = data.get("model", "")
        temperature = data.get("temperature")
        max_tokens = data.get("max_tokens")

        model = resolve_model(model_str)

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"model": model_str},
        )

        full_response = ""
        kwargs: dict[str, Any] = {}
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        try:
            async for token in model.astream(prompt, **kwargs):
                full_response += token
                yield NodeEvent(
                    node_id=context.node_id,
                    node_type=self.node_type,
                    event_type="progress",
                    run_id=context.run_id,
                    data={"token": token},
                )
        except Exception as e:
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="error",
                run_id=context.run_id,
                data={"error": str(e)},
            )
            yield ExecutionResult(
                outputs={
                    "output": DataValue(type="data", value={"text": full_response})
                }
            )
            return

        yield ExecutionResult(
            outputs={"output": DataValue(type="data", value={"text": full_response})}
        )


executor = LlmCompletionExecutor()
