"""Chat Start node — bridge between the chat interface and the graph."""

from __future__ import annotations

import types
from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext, RuntimeConfigContext

from .variables_runtime import (
    collect_specs_from_runtime,
    filter_visible,
    specs_to_payload,
    validate_values,
)


class ChatStartExecutor:
    node_type = "chat-start"

    def configure_runtime(self, data: dict[str, Any], context: RuntimeConfigContext) -> None:
        if context.mode != "chat":
            return
        primary_agent = data.get("primaryAgentId")
        if not isinstance(primary_agent, str) or not primary_agent.strip():
            return
        candidate_id = primary_agent.strip()
        nodes = context.graph_data.get("nodes", [])
        if isinstance(nodes, list):
            matched = any(
                isinstance(node, dict)
                and node.get("id") == candidate_id
                and node.get("type") == "agent"
                for node in nodes
            )
            if not matched:
                return

        services = context.services
        if services is None:
            return

        policy = getattr(services, "chat_output", None)
        if policy is None:
            policy = types.SimpleNamespace()
            setattr(services, "chat_output", policy)

        if getattr(policy, "primary_agent_id", None):
            return

        policy.primary_agent_id = candidate_id
        policy.primary_agent_source = context.node_id

    def _get_chat_input(self, context: FlowContext) -> Any:
        services = context.services
        if services is None:
            return None
        return getattr(services, "chat_input", None)

    def _get_last_user_message(self, context: FlowContext) -> str:
        chat_input = self._get_chat_input(context)
        if chat_input is not None:
            message = getattr(chat_input, "last_user_message", "")
            if message:
                return str(message)

        if context.state is not None:
            user_message = getattr(context.state, "user_message", "") or ""
            if not user_message and isinstance(context.state, dict):
                user_message = context.state.get("user_message", "")
            return str(user_message)

        return ""

    def _get_runtime_messages(self, context: FlowContext) -> list[Any]:
        chat_input = self._get_chat_input(context)
        if chat_input is None:
            return []

        runtime_messages = getattr(chat_input, "runtime_messages", None)
        if not isinstance(runtime_messages, list):
            return []
        return list(runtime_messages)

    def _get_last_user_attachments(self, context: FlowContext) -> list[dict[str, Any]]:
        chat_input = self._get_chat_input(context)
        if chat_input is None:
            return []

        attachments = getattr(chat_input, "last_user_attachments", None)
        if not isinstance(attachments, list):
            return []
        return [
            attachment for attachment in attachments if isinstance(attachment, dict)
        ]

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        del inputs

        user_message = self._get_last_user_message(context)
        attachments = self._get_last_user_attachments(context)
        runtime_messages = self._get_runtime_messages(context)
        include_user_tools = bool(data.get("includeUserTools", False))

        all_specs = collect_specs_from_runtime(data, context.runtime, context.node_id)
        submitted = self._get_submitted_variables(context)
        validated = validate_values(filter_visible(all_specs, submitted), submitted).values

        self._inject_variables_into_services(context, validated)

        return ExecutionResult(
            outputs={
                "output": DataValue(
                    type="data",
                    value={
                        "message": user_message,
                        "last_user_message": user_message,
                        "runtime_messages": runtime_messages,
                        "attachments": attachments,
                        "include_user_tools": include_user_tools,
                        "variables": validated,
                        "variable_specs": specs_to_payload(all_specs),
                    },
                )
            }
        )

    def _get_submitted_variables(self, context: FlowContext) -> dict[str, Any]:
        services = context.services
        if services is None:
            return {}
        expression_context = getattr(services, "expression_context", None)
        if not isinstance(expression_context, dict):
            return {}
        submitted = expression_context.get("variables")
        return submitted if isinstance(submitted, dict) else {}

    def _inject_variables_into_services(
        self, context: FlowContext, variables: dict[str, Any]
    ) -> None:
        services = context.services
        if services is None:
            return
        expression_context = getattr(services, "expression_context", None)
        if isinstance(expression_context, dict):
            expression_context["variables"] = dict(variables)


executor = ChatStartExecutor()
