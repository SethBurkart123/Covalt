"""Webhook End node — builds a webhook response payload."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class WebhookEndExecutor:
    node_type = "webhook-end"

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        del context
        body_value = None
        body_input = inputs.get("body")
        if body_input is not None:
            body_value = body_input.value

        status_raw = data.get("status", 200)
        try:
            status = int(status_raw)
        except (TypeError, ValueError):
            status = 200

        headers = data.get("headers", {})
        if not isinstance(headers, dict):
            headers = {}

        response_payload = {
            "body": body_value,
            "status": status,
            "headers": headers,
        }

        return ExecutionResult(
            outputs={
                "response": DataValue(type="data", value=response_payload),
            }
        )


executor = WebhookEndExecutor()
