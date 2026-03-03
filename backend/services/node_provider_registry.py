
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass
from typing import Any

from backend.models.node_provider import NodeProviderNodeDefinition
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent, RuntimeConfigContext

from .node_provider_plugin_manager import get_node_provider_plugin_manager
from .node_provider_runtime import (
    NodeProviderRuntimeError,
    NodeProviderRuntimeSpec,
    configure_provider_runtime,
    execute_provider_node,
    list_provider_definitions,
    materialize_provider_node,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RegisteredProviderNode:
    node_type: str
    plugin_id: str
    provider_id: str
    definition: dict[str, Any]
    runtime_spec: NodeProviderRuntimeSpec


_REGISTERED_PROVIDER_NODES: dict[str, RegisteredProviderNode] = {}


class ProviderNodeExecutor:
    def __init__(self, registration: RegisteredProviderNode) -> None:
        self.node_type = registration.node_type
        self._registration = registration
        capabilities = registration.definition.get('capabilities') or {}
        self._supports_materialize = bool(capabilities.get('materialize'))
        self._supports_configure_runtime = bool(capabilities.get('configureRuntime'))

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult:
        payload = {
            'providerId': self._registration.provider_id,
            'pluginId': self._registration.plugin_id,
            'nodeType': self.node_type,
            'nodeId': context.node_id,
            'nodeData': data,
            'inputs': {
                key: {'type': value.type, 'value': value.value}
                for key, value in inputs.items()
            },
            'chatId': context.chat_id,
            'runId': context.run_id,
        }
        result = execute_provider_node(self._registration.runtime_spec, payload)
        return _to_execution_result(result, node_id=context.node_id, node_type=self.node_type)

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any:
        if not self._supports_materialize:
            raise ValueError(
                f"Provider node '{self.node_type}' does not support materialize()"
            )

        payload = {
            'providerId': self._registration.provider_id,
            'pluginId': self._registration.plugin_id,
            'nodeType': self.node_type,
            'nodeId': context.node_id,
            'nodeData': data,
            'outputHandle': output_handle,
            'chatId': context.chat_id,
            'runId': context.run_id,
        }
        result = materialize_provider_node(self._registration.runtime_spec, payload)
        return result.get('value')

    def configure_runtime(self, data: dict[str, Any], context: RuntimeConfigContext) -> None:
        if not self._supports_configure_runtime:
            return

        payload = {
            'providerId': self._registration.provider_id,
            'pluginId': self._registration.plugin_id,
            'nodeType': self.node_type,
            'nodeId': context.node_id,
            'nodeData': data,
            'mode': context.mode,
        }
        configure_provider_runtime(self._registration.runtime_spec, payload)


def _to_execution_result(
    raw: dict[str, Any],
    *,
    node_id: str,
    node_type: str,
) -> ExecutionResult:
    outputs: dict[str, DataValue] = {}
    raw_outputs = raw.get('outputs')
    if isinstance(raw_outputs, dict):
        for handle, value in raw_outputs.items():
            if not isinstance(handle, str) or not handle:
                continue
            if not isinstance(value, dict):
                outputs[handle] = DataValue(type='data', value=value)
                continue
            value_type = value.get('type')
            if not isinstance(value_type, str) or not value_type:
                value_type = 'data'
            outputs[handle] = DataValue(type=value_type, value=value.get('value'))

    events: list[NodeEvent] = []
    raw_events = raw.get('events')
    if isinstance(raw_events, list):
        for item in raw_events:
            if not isinstance(item, dict):
                continue
            event_type = item.get('event_type') or item.get('eventType')
            if not isinstance(event_type, str) or not event_type:
                continue
            event_node_id = item.get('node_id') or item.get('nodeId') or node_id
            event_node_type = item.get('node_type') or item.get('nodeType') or node_type
            run_id = item.get('run_id') or item.get('runId') or ''
            events.append(
                NodeEvent(
                    node_id=str(event_node_id),
                    node_type=str(event_node_type),
                    event_type=event_type,
                    run_id=str(run_id) if run_id is not None else '',
                    data=item.get('data') if isinstance(item.get('data'), dict) else None,
                )
            )

    return ExecutionResult(outputs=outputs, events=events)


def clear_node_provider_registry() -> None:
    _REGISTERED_PROVIDER_NODES.clear()


def list_node_provider_definitions() -> list[NodeProviderNodeDefinition]:
    results: list[NodeProviderNodeDefinition] = []
    for registration in _REGISTERED_PROVIDER_NODES.values():
        try:
            results.append(NodeProviderNodeDefinition.model_validate(registration.definition))
        except Exception:
            continue
    return sorted(results, key=lambda item: (item.providerId, item.type))


def get_provider_node_registration(node_type: str) -> RegisteredProviderNode | None:
    return _REGISTERED_PROVIDER_NODES.get(node_type)


def reload_node_provider_registry() -> None:
    from nodes import clear_provider_executors, register_provider_executor

    clear_node_provider_registry()
    clear_provider_executors()

    manager = get_node_provider_plugin_manager()
    manifests = manager.get_enabled_manifests()

    for manifest in manifests:
        runtime_spec = NodeProviderRuntimeSpec(
            plugin_id=manifest.id,
            provider_id=manifest.id,
            plugin_dir=manifest.path.parent,
            entrypoint=manifest.runtime_entrypoint,
        )

        try:
            definitions = (
                _load_definitions_from_file(manifest)
                if manifest.definitions_source == 'file'
                else list_provider_definitions(runtime_spec)
            )
        except Exception as exc:
            logger.error(
                "node-provider:%s failed loading definitions: %s",
                manifest.id,
                exc,
            )
            continue

        for raw_definition in definitions:
            registration = _normalize_registration(
                manifest_id=manifest.id,
                raw_definition=raw_definition,
                runtime_spec=runtime_spec,
            )
            if registration is None:
                continue

            _REGISTERED_PROVIDER_NODES[registration.node_type] = registration

            executor = ProviderNodeExecutor(registration)
            definition = registration.definition
            caps = definition.get('capabilities') or {}

            register_provider_executor(
                node_type=registration.node_type,
                executor=executor,
                metadata={
                    'plugin_id': registration.plugin_id,
                    'provider_id': registration.provider_id,
                    'source': 'provider',
                    'has_execute': bool(caps.get('execute', True)),
                    'has_materialize': bool(caps.get('materialize')),
                    'has_configure_runtime': bool(caps.get('configureRuntime')),
                    'has_init_routes': False,
                },
            )


def _load_definitions_from_file(manifest: Any) -> list[dict[str, Any]]:
    file_name = manifest.definitions_file
    if not file_name:
        raise NodeProviderRuntimeError('definitions.file is required')
    file_path = manifest.path.parent / file_name
    if not file_path.exists() or not file_path.is_file():
        raise NodeProviderRuntimeError(f'definitions file not found: {file_name}')

    import json

    raw = json.loads(file_path.read_text())
    if isinstance(raw, dict):
        raw_defs = raw.get('definitions')
        if isinstance(raw_defs, list):
            return [dict(item) for item in raw_defs if isinstance(item, dict)]
    if isinstance(raw, list):
        return [dict(item) for item in raw if isinstance(item, dict)]
    raise NodeProviderRuntimeError('definitions file must be array or {definitions: []}')


def _normalize_registration(
    *,
    manifest_id: str,
    raw_definition: dict[str, Any],
    runtime_spec: NodeProviderRuntimeSpec,
) -> RegisteredProviderNode | None:
    node_key = str(raw_definition.get('type') or '').strip()
    if not node_key:
        return None

    normalized_type = node_key
    if ':' not in normalized_type:
        normalized_type = f'{manifest_id}:{node_key}'

    definition = copy.deepcopy(raw_definition)
    definition['type'] = normalized_type
    definition['source'] = 'provider'
    definition['providerId'] = manifest_id
    definition['pluginId'] = manifest_id
    definition.setdefault('capabilities', {
        'execute': True,
        'materialize': False,
        'configureRuntime': False,
        'routes': False,
    })

    try:
        parsed = NodeProviderNodeDefinition.model_validate(definition)
    except Exception as exc:
        logger.error('node-provider:%s invalid definition (%s): %s', manifest_id, node_key, exc)
        return None

    return RegisteredProviderNode(
        node_type=parsed.type,
        plugin_id=manifest_id,
        provider_id=manifest_id,
        definition=parsed.model_dump(),
        runtime_spec=runtime_spec,
    )
