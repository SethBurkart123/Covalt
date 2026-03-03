from __future__ import annotations

from types import SimpleNamespace

import pytest

from nodes._types import DataValue, FlowContext
from nodes.core.webhook_end.executor import WebhookEndExecutor
from nodes.core.webhook_trigger.executor import WebhookTriggerExecutor


def _flow_context(*, webhook: object | None) -> FlowContext:
    services = SimpleNamespace(webhook=webhook)
    return FlowContext(
        node_id="node-1",
        chat_id=None,
        run_id="run-1",
        state=SimpleNamespace(user_message=""),
        services=services,
    )


@pytest.mark.asyncio
async def test_webhook_trigger_executor_returns_webhook_payload() -> None:
    executor = WebhookTriggerExecutor()
    payload = {"test": True, "nested": {"value": 1}}

    result = await executor.execute({}, {}, _flow_context(webhook=payload))

    assert result.outputs["output"].type == "data"
    assert result.outputs["output"].value == payload


@pytest.mark.asyncio
async def test_webhook_trigger_executor_defaults_to_empty_payload() -> None:
    executor = WebhookTriggerExecutor()

    result = await executor.execute({}, {}, _flow_context(webhook=None))

    assert result.outputs["output"].type == "data"
    assert result.outputs["output"].value == {}


@pytest.mark.asyncio
async def test_webhook_end_executor_shapes_response_output() -> None:
    executor = WebhookEndExecutor()
    context = _flow_context(webhook=None)

    result = await executor.execute(
        {"status": 202, "headers": {"x-test": "1"}},
        {"body": DataValue(type="data", value={"ok": True})},
        context,
    )

    assert result.outputs["response"].type == "data"
    assert result.outputs["response"].value == {
        "status": 202,
        "headers": {"x-test": "1"},
        "body": {"ok": True},
    }


@pytest.mark.asyncio
async def test_webhook_end_executor_defaults_invalid_status_and_headers() -> None:
    executor = WebhookEndExecutor()
    context = _flow_context(webhook=None)

    result = await executor.execute(
        {"status": "not-a-number", "headers": "invalid"},
        {"body": DataValue(type="data", value="hello")},
        context,
    )

    assert result.outputs["response"].value == {
        "status": 200,
        "headers": {},
        "body": "hello",
    }
