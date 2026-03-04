# Creating Plugins for Covalt

This guide explains how to create plugins for Covalt’s node system from first principles. It is written for developers who are comfortable with TypeScript and Python, but who have not worked in this codebase before. By the end, you should be able to define a node, implement its runtime behavior, register lifecycle hooks, test it in isolation, and package it for installation from a GitHub repository or zip upload.

Covalt’s plugin architecture has two practical authoring surfaces. The first is the in-repo plugin surface used by builtin nodes: TypeScript definitions for editor behavior and Python executors for runtime behavior. The second is the distributable node-provider surface used for installable external packages: a `node-provider.yaml` manifest plus a Bun runtime entrypoint that implements the RPC methods the backend expects. You will use the first surface to design node behavior and the second surface when you distribute installable plugins.

## 1) Plugin structure overview

A plugin is a bundle of node contracts that connects three layers: editor metadata (what users see and configure), runtime execution (what the node does when a flow runs), and optional lifecycle hooks (where a plugin can influence creation, validation, route extraction, entry selection, and response extraction). The architecture is intentionally split so UI concerns stay declarative in TypeScript while execution stays explicit in Python.

A typical in-repo plugin layout mirrors the builtin `nodes/` package and keeps each node self-contained with a `definition.ts` and `executor.py` pair.

```text
nodes/
  my_plugin/
    my_node/
      definition.ts
      executor.py
      __init__.py
  manifest.ts          # TypeScript plugin manifest (frontend registry)
  plugin.py            # Python registration (backend registry)
```

A distributable external plugin (installable from repo or zip) uses a `node-provider.yaml` manifest and a Bun runtime entrypoint. The backend loads this package, validates it, and installs optional Python dependencies into the shared environment.

```text
my-provider-plugin/
  node-provider.yaml
  src/
    main.ts            # RPC entrypoint (list_definitions/execute/...)
  package.json
  runtime-config.json  # optional plugin runtime config
```

If you are learning the system, start by building one in-repo node end to end. That gives you a strong mental model for `NodeDefinition`, executor contracts, and hooks. After that, packaging for distribution is mostly about satisfying the provider manifest and RPC contract.

## 2) Plugin manifest format

On the frontend side, plugin manifests are TypeScript objects. The registry validates required fields (`id`, `name`, `version`, `nodes`) and then merges definitions, hooks, and optional custom components.

```ts
// nodes/_manifest.ts
export interface NodeEntry {
  type: string;
  definitionPath: string;
  executorPath: string;
  hooks?: FrontendHookHandlers;
  definition?: NodeDefinition;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  nodes: readonly NodeEntry[];
  hooks?: FrontendHookHandlers;
  components?: Readonly<Record<string, unknown>>;
  definitions?: readonly NodeDefinition[];
}
```

A minimal manifest that registers one node definition and one per-node creation hook looks like this.

```ts
import type { PluginManifest } from '@nodes/_manifest';
import { textTransform } from './data/text_transform/definition';

export const textPluginManifest: PluginManifest = {
  id: 'example.text-plugin',
  name: 'Example Text Plugin',
  version: '1.0.0',
  nodes: [
    {
      type: 'example.text-transform',
      definitionPath: 'nodes/data/text_transform/definition.ts',
      executorPath: 'nodes/data/text_transform/executor.py',
      hooks: {
        onNodeCreate: (context) => {
          if (typeof context.initialData.mode === 'string') return undefined;
          return { mode: 'uppercase' };
        },
      },
    },
  ],
  definitions: [textTransform],
};
```

When you distribute a plugin through install commands, the backend validates `node-provider.yaml` instead. This is the install contract that powers GitHub and zip flows.

```yaml
manifest_version: '1'
id: example-provider
name: Example Provider
version: 1.0.0
runtime:
  kind: bun
  entrypoint: src/main.ts
definitions:
  source: runtime
python_dependencies:
  - requests==2.32.3
```

The provider manifest is strict and intentionally defensive. IDs must match `^[a-z0-9][a-z0-9_-]*$`, `runtime.kind` must be `bun`, and non-HTTPS repository URLs are rejected. This strictness prevents ambiguous plugin identity and avoids unsafe install sources.

## 3) Node definition files

A node definition is the editor-facing contract. It describes what appears in the node palette, which sockets exist, what parameter controls are rendered, and which execution mode the runtime should expect. The execution engine does not read this file directly at runtime, but execution behavior should still align with the definition so users can reason about flow behavior from the UI.

```ts
// nodes/_types.ts (selected)
export interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  category: 'trigger' | 'llm' | 'tools' | 'flow' | 'data' | 'integration' | 'rag' | 'utility';
  icon: string;
  executionMode: 'structural' | 'flow' | 'hybrid';
  parameters: readonly Parameter[];
  metadata?: NodeDefinitionMetadata;
  component?: unknown;
}
```

Here is a complete definition for a simple text transformation node. It has a data input, data output, an enum mode selector, and an optional string prefix. The execution mode is `flow` because it only participates during runtime execution.

```ts
import type { NodeDefinition } from '../../_types';

export const textTransform = {
  id: 'example.text-transform',
  name: 'Text Transform',
  description: 'Transforms incoming text using a selected strategy',
  category: 'data',
  icon: 'TextCursorInput',
  executionMode: 'flow',
  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Input',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'output',
      type: 'data',
      label: 'Output',
      mode: 'output',
      socket: { type: 'data' },
    },
    {
      id: 'mode',
      type: 'enum',
      label: 'Mode',
      mode: 'constant',
      values: ['uppercase', 'lowercase', 'trim'],
      default: 'uppercase',
    },
    {
      id: 'prefix',
      type: 'string',
      label: 'Prefix',
      mode: 'constant',
      default: '',
      placeholder: 'Optional prefix',
    },
  ],
} as const satisfies NodeDefinition;

export default textTransform;
```

For route-capable nodes, use metadata instead of hardcoded node-type checks. The builtins use this pattern for webhook behavior.

```ts
metadata: {
  route: {
    idField: 'hookId',
    path: '/webhooks/{id}',
    label: 'Webhook URL',
    idPrefix: 'hook_',
    emptyValuePlaceholder: 'Generate a hook id first',
  },
}
```

## 4) Node executor files (Python)

Executors are backend runtime implementations. They read node `data`, consume typed `inputs`, and return an `ExecutionResult` with typed outputs. Optional methods `materialize` and `configure_runtime` support advanced nodes that resolve link-channel artifacts (like tools) or adjust runtime policy before execution begins.

```python
# nodes/_types.py (selected)
class FlowExecutor(Protocol):
    node_type: str
    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult | AsyncIterator[NodeEvent | ExecutionResult]: ...

class LinkMaterializer(Protocol):
    node_type: str
    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any: ...

class RuntimeConfigurator(Protocol):
    node_type: str
    def configure_runtime(
        self,
        data: dict[str, Any],
        context: RuntimeConfigContext,
    ) -> None: ...
```

A complete executor for the text transform node can stay small and explicit.

```python
from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class TextTransformExecutor:
    node_type = "example.text-transform"

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult:
        del context

        raw_input = inputs.get("input", DataValue(type="data", value={"text": ""})).value
        if isinstance(raw_input, dict):
            text = str(raw_input.get("text") or raw_input.get("message") or "")
        else:
            text = str(raw_input)

        mode = str(data.get("mode") or "uppercase")
        prefix = str(data.get("prefix") or "")

        if mode == "lowercase":
            transformed = text.lower()
        elif mode == "trim":
            transformed = text.strip()
        else:
            transformed = text.upper()

        output = {"text": f"{prefix}{transformed}"}
        return ExecutionResult(outputs={"output": DataValue(type="data", value=output)})


executor = TextTransformExecutor()
```

When you need optional capabilities, implement them directly and keep behavior constrained to explicit handles.

```python
class ExampleHybridExecutor:
    node_type = "example.hybrid"

    async def materialize(self, data: dict[str, Any], output_handle: str, context: FlowContext) -> list[Any]:
        if output_handle != "tools":
            raise ValueError(f"unknown output handle: {output_handle}")
        registry = getattr(context.services, "tool_registry", None)
        if registry is None:
            return []
        toolset_id = str(data.get("toolset") or "")
        if not toolset_id:
            return []
        return registry.resolve_tool_ids([f"toolset:{toolset_id}"], chat_id=context.chat_id)

    def configure_runtime(self, data: dict[str, Any], context: RuntimeConfigContext) -> None:
        if context.mode != "chat":
            return
        services = context.services
        if services is None:
            return
        setattr(services, "example_policy", {"origin": context.node_id, "enabled": bool(data.get("enabled", True))})
```

## 5) Lifecycle hooks

Lifecycle hooks let plugins participate in core behaviors without hardcoding node type checks in framework code. Backend hooks are defined by `HookType` in `nodes/_types.py`, while frontend hooks are defined in `nodes/_types.ts` and run through the frontend hook dispatcher.

```python
# backend hook enum
class HookType(StrEnum):
    ON_NODE_CREATE = "onNodeCreate"
    ON_CONNECTION_VALIDATE = "onConnectionValidate"  # declared, but not currently dispatched as a backend enforcement gate
    ON_ROUTE_EXTRACT = "onRouteExtract"
    ON_ENTRY_RESOLVE = "onEntryResolve"
    ON_RESPONSE_EXTRACT = "onResponseExtract"
    ON_SOCKET_TYPE_PROPAGATE = "onSocketTypePropagate"
```

```ts
// frontend hook types
export type FrontendHookType =
  | 'onNodeCreate'
  | 'onConnectionValidate'
  | 'onSocketTypePropagate';
```

`onConnectionValidate` is currently a frontend-only hook. It runs in the editor when users draw connections so plugins can allow or deny specific source/target combinations in the UI. The backend runtime path does not currently dispatch `HookType.ON_CONNECTION_VALIDATE` as a flow-execution enforcement gate, so treat this hook as compatibility filtering in the canvas rather than runtime policy enforcement.

On the frontend, hooks are usually attached per node in `NodeEntry.hooks` and scoped by node type automatically by the plugin registry.

```ts
hooks: {
  onNodeCreate: (context) => {
    if (context.nodeType !== 'example.trigger') return undefined;
    if (typeof context.initialData.hookId === 'string' && context.initialData.hookId.trim()) {
      return undefined;
    }
    return { hookId: `hook_${Math.random().toString(36).slice(2, 10)}` };
  },
  onConnectionValidate: (context) => {
    const from = context.sourceNodeType;
    const to = context.targetNodeType;
    // UI-only filtering: false prevents creating this edge in the editor.
    if (from === 'example.trigger' && to !== 'agent') return false;
    return undefined;
  },
}
```

On the backend, register hooks together with executors in the plugin registry. This is how route extraction, entry selection, and response extraction stay generic.

```python
from backend.services.plugin_registry import register_plugin
from nodes._types import HookType


def register_example_plugin() -> None:
    register_plugin(
        "example.backend",
        executors={"example.text-transform": executor},
        hooks={
            HookType.ON_ROUTE_EXTRACT: [
                lambda context: context["data"].get("hookId") if context.get("node_type") == "example.trigger" else None
            ],
            HookType.ON_ENTRY_RESOLVE: [
                lambda context: "example.chat-start" if context.get("mode") == "chat" else None
            ],
            HookType.ON_RESPONSE_EXTRACT: [
                lambda context: _extract_http_response(context)
            ],
        },
        metadata={"source": "example"},
    )
```

Hook failures are isolated by design. If one plugin hook raises an exception, the dispatcher logs the failure and continues executing remaining hooks. This means plugin hook handlers should still be defensive, but one bad handler should not stop other plugins from functioning.

## 6) Testing plugins in isolation

You should test plugin definitions and executors separately. Definition tests validate registration, metadata, and hook behavior in the frontend registry. Executor tests validate runtime contracts and output shape in Python. Keeping the tests separate dramatically shortens feedback loops when you iterate.

A frontend definition and hook test can register a manifest, then assert that hooks and definitions are visible.

```ts
import { describe, expect, it } from 'vitest';
import { registerPlugin, resetPluginRegistryForTests, getNodeDefinition } from '@/lib/flow/plugin-registry';
import { applyNodeCreateHooks } from '@/lib/flow/hook-dispatch';

import { textPluginManifest } from './manifest';

describe('text plugin manifest', () => {
  it('registers definition and applies onNodeCreate patch', () => {
    resetPluginRegistryForTests();
    registerPlugin(textPluginManifest);

    expect(getNodeDefinition('example.text-transform')?.name).toBe('Text Transform');

    const created = applyNodeCreateHooks({
      nodeType: 'example.text-transform',
      initialData: {},
    });
    expect(created.mode).toBe('uppercase');
  });
});
```

A backend executor test can instantiate a realistic `FlowContext` and assert output semantics.

```python
import types
import pytest

from nodes._types import DataValue, FlowContext
from nodes.my_plugin.my_node.executor import executor


@pytest.mark.asyncio
async def test_text_transform_executor_uppercases_input() -> None:
    result = await executor.execute(
        {"mode": "uppercase", "prefix": "Result: "},
        {"input": DataValue(type="data", value={"text": "covalt"})},
        FlowContext(
            node_id="node-1",
            chat_id=None,
            run_id="run-1",
            state=types.SimpleNamespace(),
            runtime=None,
            services=types.SimpleNamespace(),
        ),
    )

    assert result.outputs["output"].value == {"text": "Result: COVALT"}
```

For hook-specific backend behavior, test dispatch directly through the plugin registry.

```python
from backend.services.plugin_registry import PluginRegistry
from nodes._types import HookType


def test_route_extract_hook_returns_route_id() -> None:
    registry = PluginRegistry()
    registry.register_plugin(
        "example.routes",
        hooks={
            HookType.ON_ROUTE_EXTRACT: [
                lambda context: context["data"].get("hookId")
                if context.get("node_type") == "example.trigger"
                else None
            ]
        },
    )

    results = registry.dispatch_hook(
        HookType.ON_ROUTE_EXTRACT,
        {"node_type": "example.trigger", "data": {"hookId": "hook_123"}},
    )
    assert results == ["hook_123"]
```

## 7) Installation and distribution

Distribution is intentionally simple: publish your plugin code in a GitHub repository (or zip it), then install it through the node-provider plugin commands. The backend manager validates manifest safety, extracts the plugin, installs optional Python dependencies, and refreshes the node provider registry so definitions become visible without restarting the app.

A practical installable provider package needs `node-provider.yaml` and a runtime entrypoint that returns JSON envelopes with `ok` and `result` fields. The runtime should implement methods the backend calls (`list_definitions`, `execute`, `materialize`, `configure_runtime`, `handle_route`) depending on your node capabilities.

```ts
// src/main.ts in a node-provider package (minimal contract)
interface RpcRequest { method: string; payload: Record<string, unknown>; }

function ok(result: Record<string, unknown>) {
  return { ok: true, result };
}

function fail(message: string) {
  return { ok: false, error: { message } };
}

async function processRequest(req: RpcRequest) {
  switch (req.method) {
    case 'list_definitions':
      return ok({
        definitions: [
          {
            type: 'example-provider:text-transform',
            name: 'Text Transform',
            category: 'data',
            icon: 'TextCursorInput',
            executionMode: 'flow',
            parameters: [],
            capabilities: { execute: true, materialize: false, configureRuntime: false, routes: false },
            providerId: 'example-provider',
            pluginId: 'example-provider',
          },
        ],
      });
    case 'execute':
      return ok({ outputs: { output: { type: 'data', value: { text: 'ok' } } } });
    default:
      return fail(`Unsupported method: ${req.method}`);
  }
}
```

From the backend/API perspective, installation and lifecycle are command-driven.

```text
list_node_provider_plugins
install_node_provider_plugin_from_repo
import_node_provider_plugin          # zip upload
enable_node_provider_plugin
uninstall_node_provider_plugin
list_node_provider_definitions
```

If you are driving installs from scripts, the command names map directly to backend command handlers. The repository installer only accepts HTTPS GitHub URLs, and zip imports reject traversal entries and archives larger than 20 MB. Dependency installation is shared-environment, not per-plugin virtualenv isolation, so pin dependencies conservatively and test in a clean environment.

## 8) Error handling and debugging

When plugin loading fails, begin by validating the manifest and install source, then move to runtime contract checks. Most failures are either manifest schema mistakes, invalid runtime envelopes, or missing fields in definitions. Debugging becomes much faster if you treat each stage independently: installation, definition loading, executor invocation, then hook dispatch.

The runtime bridge already emits detailed method-context errors. Typical messages include plugin ID and RPC method, so use that context instead of adding generic try/except wrappers that hide root causes.

```text
Node provider runtime 'plugin-123' method 'list_definitions' returned empty response
Node provider runtime 'plugin-123' method 'execute' returned invalid JSON | output: <<<not-json>>>
Node provider runtime 'plugin-123' method 'materialize' returned invalid result shape
Node provider runtime 'plugin-123' method 'configure_runtime' failed with exit code 3 | stderr: ...
```

A reliable debugging workflow is to first call `list_node_provider_plugins` and confirm install state, then call `list_node_provider_definitions` and confirm normalized node types and metadata, then execute a tiny test flow with one node. If route behavior is involved, verify `hookId`/`routeId` is present and ensure your node type reports route capability through hooks or route config. If custom rendering fails, confirm your `components` map key exactly matches the node type string and that the component export is a function.

## 9) Complete example A: simple text transform node (manifest + definition + executor)

This first complete example is the smallest realistic plugin node that transforms text. It includes all three required files and can be used as a template for any deterministic data node.

```ts
// nodes/example/manifest.ts
import type { PluginManifest } from '@nodes/_manifest';
import { textTransform } from './data/text_transform/definition';

export const exampleManifest: PluginManifest = {
  id: 'example.text-plugin',
  name: 'Example Text Plugin',
  version: '1.0.0',
  nodes: [
    {
      type: 'example.text-transform',
      definitionPath: 'nodes/example/data/text_transform/definition.ts',
      executorPath: 'nodes/example/data/text_transform/executor.py',
    },
  ],
  definitions: [textTransform],
};
```

```ts
// nodes/example/data/text_transform/definition.ts
import type { NodeDefinition } from '../../../_types';

export const textTransform = {
  id: 'example.text-transform',
  name: 'Text Transform',
  category: 'data',
  icon: 'TextCursorInput',
  executionMode: 'flow',
  parameters: [
    { id: 'input', type: 'data', label: 'Input', mode: 'input', socket: { type: 'data' } },
    { id: 'output', type: 'data', label: 'Output', mode: 'output', socket: { type: 'data' } },
    { id: 'mode', type: 'enum', label: 'Mode', mode: 'constant', values: ['uppercase', 'lowercase'], default: 'uppercase' },
  ],
} as const satisfies NodeDefinition;
```

```python
# nodes/example/data/text_transform/executor.py
from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class TextTransformExecutor:
    node_type = "example.text-transform"

    async def execute(self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext) -> ExecutionResult:
        del context
        raw = inputs.get("input", DataValue(type="data", value={"text": ""})).value
        text = str(raw.get("text") if isinstance(raw, dict) else raw)
        mode = str(data.get("mode") or "uppercase")
        text = text.upper() if mode == "uppercase" else text.lower()
        return ExecutionResult(outputs={"output": DataValue(type="data", value={"text": text})})


executor = TextTransformExecutor()
```

## 10) Complete example B: trigger node with lifecycle hooks

This example shows a route-capable trigger that auto-generates `hookId` on creation and lets backend route extraction stay generic through hooks instead of hardcoded node type checks.

```ts
// frontend manifest entry with onNodeCreate hook
{
  type: 'example.trigger',
  definitionPath: 'nodes/example/trigger/definition.ts',
  executorPath: 'nodes/example/trigger/executor.py',
  hooks: {
    onNodeCreate: (context) => {
      const existing = context.initialData.hookId;
      if (typeof existing === 'string' && existing.trim()) return undefined;
      return { hookId: `hook_${Math.random().toString(36).slice(2, 10)}` };
    },
  },
}
```

```ts
// nodes/example/trigger/definition.ts
import type { NodeDefinition } from '../../_types';

export const triggerDefinition = {
  id: 'example.trigger',
  name: 'Example Trigger',
  category: 'trigger',
  icon: 'Webhook',
  executionMode: 'hybrid',
  metadata: {
    route: {
      idField: 'hookId',
      path: '/webhooks/{id}',
      label: 'Webhook URL',
      idPrefix: 'hook_',
    },
  },
  parameters: [
    { id: 'output', type: 'data', label: 'Data', mode: 'output', socket: { type: 'data' } },
    { id: 'hookId', type: 'string', label: 'Hook ID', mode: 'constant', default: '', renderScope: 'inspector' },
  ],
} as const satisfies NodeDefinition;
```

```python
# nodes/example/trigger/executor.py
from __future__ import annotations

from typing import Any

from nodes._types import DataValue, ExecutionResult, FlowContext


class ExampleTriggerExecutor:
    node_type = "example.trigger"

    async def execute(self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext) -> ExecutionResult:
        del data, inputs
        payload = getattr(getattr(context, "services", None), "webhook", None) or {}
        return ExecutionResult(outputs={"output": DataValue(type="data", value=payload)})


executor = ExampleTriggerExecutor()
```

```python
# backend hook registration for route extraction
from backend.services.plugin_registry import register_plugin
from nodes._types import HookType

register_plugin(
    "example.trigger-plugin",
    executors={"example.trigger": executor},
    hooks={
        HookType.ON_ROUTE_EXTRACT: [
            lambda context: context["data"].get("hookId")
            if context.get("node_type") == "example.trigger"
            else None
        ]
    },
)
```

## 11) Complete example C: node with a custom React component

Custom components are optional and always fall back to the generic node renderer if missing. The plugin registry attaches components by node type key, and `FlowNode` resolves them at render time. This gives you an escape hatch for highly specialized UX while keeping most nodes declarative.

```tsx
// nodes/example/ui/highlight-node.tsx
'use client';

import type { NodeProps } from '@xyflow/react';

interface HighlightData {
  title?: string;
  subtitle?: string;
}

export function HighlightNode(props: NodeProps) {
  const data = (props.data ?? {}) as HighlightData;

  return (
    <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 shadow-sm">
      <div className="text-sm font-semibold">{data.title ?? 'Highlight Node'}</div>
      <div className="text-xs text-muted-foreground">{data.subtitle ?? 'Custom renderer active'}</div>
    </div>
  );
}
```

```ts
// nodes/example/ui/definition.ts
import type { NodeDefinition } from '../../_types';

export const highlightDefinition = {
  id: 'example.highlight',
  name: 'Highlight',
  description: 'Node rendered by a custom React component',
  category: 'utility',
  icon: 'Sparkles',
  executionMode: 'flow',
  parameters: [
    { id: 'input', type: 'data', label: 'Input', mode: 'input', socket: { type: 'data' } },
    { id: 'output', type: 'data', label: 'Output', mode: 'output', socket: { type: 'data' } },
    { id: 'title', type: 'string', label: 'Title', mode: 'constant', default: 'Highlight Node' },
    { id: 'subtitle', type: 'string', label: 'Subtitle', mode: 'constant', default: 'Custom renderer active' },
  ],
} as const satisfies NodeDefinition;
```

```ts
// manifest fragment wiring the custom component
import { HighlightNode } from './ui/highlight-node';
import { highlightDefinition } from './ui/definition';

export const uiPluginManifest: PluginManifest = {
  id: 'example.ui-plugin',
  name: 'Example UI Plugin',
  version: '1.0.0',
  nodes: [
    {
      type: 'example.highlight',
      definitionPath: 'nodes/example/ui/definition.ts',
      executorPath: 'nodes/example/ui/executor.py',
    },
  ],
  definitions: [highlightDefinition],
  components: {
    'example.highlight': HighlightNode,
  },
};
```

When this plugin is registered, `app/components/flow/node.tsx` resolves `definition.component` and renders your `HighlightNode`. If the component map does not contain the node type key, the generic renderer is used with no special handling required.

---

If you keep definition contracts explicit, executor behavior deterministic, and hooks narrowly scoped, plugin development stays predictable. The existing builtin nodes are good references for execution semantics and metadata conventions, and the provider install path is strict enough to catch most packaging mistakes early. Start with one small node, test it in isolation, and only then add hooks or custom UI when the basic behavior is stable.
