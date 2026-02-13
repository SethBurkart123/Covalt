"""Webhook Trigger node — entry point for HTTP webhooks."""

from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class WebhookTriggerExecutor:
    node_type = "webhook-trigger"

    def _get_webhook_payload(self, context: FlowContext) -> Any:
        services = context.services
        if services is None:
            return None
        return getattr(services, "webhook", None)

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        del data, inputs
        payload = self._get_webhook_payload(context) or {}
        return ExecutionResult(
            outputs={
                "output": DataValue(type="data", value=payload),
            }
        )


executor = WebhookTriggerExecutor()
