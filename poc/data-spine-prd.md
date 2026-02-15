# PRD: Data Spine Migration

Exact specification for migrating the flow graph from typed main-flow sockets to a generic n8n-style data spine with Blender-style typed side sockets.

Read `poc/architecture.md` first for the conceptual design. This document is the implementation spec.

---

## Summary of Changes

The main data flow between nodes currently uses typed sockets (`string`, `json`, `messages`). We are replacing this with a single generic `data` socket type — untyped JSON that flows through every node. Typed sockets (`model`, `float`, `string`, `agent`, `tools`, etc.) remain for structural composition and hybrid parameter configuration.

The expression system upgrades from `{{ input.fieldName }}` to `{{ $('Node Name').item.json.fieldPath }}`, allowing any parameter to reference any upstream node's output by display name.

---

## Phase 1: Type System — Add `data` Socket Type

### 1.1 `nodes/_types.ts`

**Add `'data'` to `SocketTypeId`** (line 7-10):

```typescript
// BEFORE:
export type SocketTypeId =
  | 'agent' | 'tools'
  | 'float' | 'int' | 'string' | 'boolean'
  | 'json' | 'messages' | 'model';

// AFTER:
export type SocketTypeId =
  | 'data'
  | 'agent' | 'tools'
  | 'float' | 'int' | 'string' | 'boolean'
  | 'json' | 'messages' | 'model';
```

**Add `'data'` to `ParameterType`** (line 15-27):

```typescript
// AFTER (add to the union):
export type ParameterType =
  | 'data'    // NEW
  | 'float'
  | 'int'
  // ... rest unchanged
```

**Add `DataParameter` interface** (after `JsonParameter`, before the `Parameter` union):

```typescript
/** Data spine parameter — generic JSON flow */
export interface DataParameter extends ParameterBase {
  type: 'data';
}
```

**Add `DataParameter` to the `Parameter` union** (line 156-168):

```typescript
export type Parameter =
  | FloatParameter
  | IntParameter
  | StringParameter
  | BooleanParameter
  | EnumParameter
  | TextAreaParameter
  | ModelParameter
  | McpServerParameter
  | ToolsetParameter
  | AgentParameter
  | ToolsParameter
  | JsonParameter
  | DataParameter;  // NEW
```

**Add `label` field to `FlowNode`** (line 194-199). This is needed for `$('Node Name')` expression resolution:

```typescript
// BEFORE:
export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

// AFTER:
export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  /** User-facing display name. Defaults to NodeDefinition.name. Used by $() expressions. */
  label?: string;
}
```

### 1.2 `app/lib/flow/sockets.ts`

**Add `data` entry to `SOCKET_TYPES`** (line 12-60). Place it FIRST, before structural types:

```typescript
export const SOCKET_TYPES: Record<SocketTypeId, SocketType> = {
  // Data spine
  data: {
    id: 'data',
    color: '#94a3b8',  // slate-400 — neutral, distinct from all typed colors
    shape: 'circle',
  },
  // Structural types
  agent: { ... },
  // ... rest unchanged
```

**Update `canConnect()`** (line 96-104). Add data spine bypass at the top:

```typescript
export function canConnect(sourceType: SocketTypeId, targetParam: Parameter): boolean {
  const targetType = targetParam.socket?.type ?? (targetParam.type as SocketTypeId);

  // Data spine: data connects to data, nothing else
  if (sourceType === 'data' || targetType === 'data') {
    return sourceType === 'data' && targetType === 'data';
  }

  // Side sockets: existing logic unchanged
  if (targetParam.acceptsTypes) {
    return targetParam.acceptsTypes.includes(sourceType);
  }

  return canCoerce(sourceType, targetType);
}
```

### 1.3 `nodes/_coerce.py`

**No changes to the coercion table.** The `data` type does not participate in coercion. The `COERCION_TABLE` (line 63-75) stays exactly as-is — it only applies to typed side socket connections.

### 1.4 `nodes/_types.py`

**No structural changes needed.** `DataValue` already uses `type: str` and `value: Any`. Data spine outputs will use `DataValue(type="data", value={...})`. The `type="data"` string is the convention; no code enforces it.

---

## Phase 2: Node Definitions — Migrate to Data Spine

Every flow-capable node gets its main I/O sockets changed from typed (`json`/`string`/`messages`) to generic `data`.

### 2.1 Chat Start (`nodes/core/chat_start/definition.ts`)

**Replace `message` output parameter** (line 28-34):

```typescript
// BEFORE:
{
  id: 'message',
  type: 'string',
  label: 'Message',
  mode: 'output',
  socket: { type: 'string' },
},

// AFTER:
{
  id: 'output',
  type: 'data',
  label: 'Output',
  mode: 'output',
  socket: { type: 'data' },
},
```

Everything else stays: `agent` output (structural), `includeUserTools` (constant).

### 2.2 Agent (`nodes/core/agent/definition.ts`)

**Replace `data` input parameter** (line 35-42):

```typescript
// BEFORE:
{
  id: 'data',
  type: 'json',
  label: 'Data',
  mode: 'input',
  socket: { type: 'json', side: 'left' },
  acceptsTypes: ['json', 'string', 'messages'],
},

// AFTER:
{
  id: 'input',
  type: 'data',
  label: 'Input',
  mode: 'input',
  socket: { type: 'data' },
},
```

Note: `acceptsTypes` is removed entirely. The data spine is untyped.

**Replace `response` output parameter** (line 43-49):

```typescript
// BEFORE:
{
  id: 'response',
  type: 'string',
  label: 'Response',
  mode: 'output',
  socket: { type: 'string' },
},

// AFTER:
{
  id: 'output',
  type: 'data',
  label: 'Output',
  mode: 'output',
  socket: { type: 'data' },
},
```

Everything else stays: `agent` (structural), `tools` (structural), `model` (hybrid side socket), `instructions` (hybrid side socket), `temperature` (hybrid side socket), `name`/`description` (constants).

### 2.3 LLM Completion (`nodes/ai/llm_completion/definition.ts`)

**Replace `data` input parameter** (line 17-23):

```typescript
// BEFORE:
{
  id: 'data',
  type: 'json',
  label: 'Data',
  mode: 'input',
  socket: { type: 'json', side: 'left' },
},

// AFTER:
{
  id: 'input',
  type: 'data',
  label: 'Input',
  mode: 'input',
  socket: { type: 'data' },
},
```

**Replace `text` output parameter** (line 61-67):

```typescript
// BEFORE:
{
  id: 'text',
  type: 'text-area',
  label: 'Output',
  mode: 'output',
  socket: { type: 'string' },
},

// AFTER:
{
  id: 'output',
  type: 'data',
  label: 'Output',
  mode: 'output',
  socket: { type: 'data' },
},
```

Everything else stays: `model` (hybrid), `prompt` (hybrid), `temperature` (hybrid), `max_tokens` (constant).

### 2.4 Prompt Template (Removed)

The Prompt Template node is redundant now that `{{ ... }}` expressions are supported on any node parameter. Use expressions on the LLM Completion prompt (or other node params) instead of a dedicated template node.

### 2.5 Conditional (`nodes/flow/conditional/definition.ts`)

**Replace `data` input parameter** (line 17-23):

```typescript
// BEFORE:
{
  id: 'data',
  type: 'json',
  label: 'Data',
  mode: 'input',
  socket: { type: 'json', side: 'left' },
},

// AFTER:
{
  id: 'input',
  type: 'data',
  label: 'Input',
  mode: 'input',
  socket: { type: 'data' },
},
```

**Remove the redundant `input` parameter entirely** (line 24-30). Currently the Conditional has TWO input sockets (`data` and `input`), both typed `json`. Delete the second one. The single `input` data socket is all that's needed.

**Replace `true` output parameter** (line 55-61):

```typescript
// BEFORE:
{
  id: 'true',
  type: 'json',
  label: 'True',
  mode: 'output',
  socket: { type: 'json' },
},

// AFTER:
{
  id: 'true',
  type: 'data',
  label: 'True',
  mode: 'output',
  socket: { type: 'data' },
},
```

**Replace `false` output parameter** (line 62-68) — same pattern as `true`.

Note: Conditional keeps two output ports (`true`/`false`) with different IDs. This is correct — branching requires distinct output ports. They just become `data` typed instead of `json` typed.

`field`, `operator`, `value` (constants) stay unchanged.

### 2.6 Model Selector (`nodes/utility/model_selector/definition.ts`)

**No data spine changes.** This node is a pure typed-side-socket utility (model in, model out). It does not participate in the data spine. Both its `model` input (hybrid) and `output` (model) are correctly typed side sockets.

**Change `executionMode` from `'flow'` to `'structural'`** (line 14). This node has no `data` I/O — it's a configuration fan-out utility, not a flow node. Its executor's `execute()` method passes model values through typed sockets, which is a side-socket concern.

### 2.7 MCP Server & Toolset

**No changes.** These are structural-only nodes with only typed side sockets (`tools` output). They don't touch the data spine.

### 2.8 Handle ID Convention

All data spine sockets now use standardized handle IDs:
- **Input**: `id: 'input'` (was `'data'` on most nodes)
- **Output**: `id: 'output'` (was `'message'`/`'response'`/`'text'` depending on node)
- **Exception**: Conditional keeps `'true'` and `'false'` as output IDs for branching

This standardization means edges on the data spine always use `sourceHandle: 'output'` and `targetHandle: 'input'` (or `'true'`/`'false'` for conditional branches).

---

## Phase 3: Executor Changes — JSON Blob Outputs

Every flow executor's output changes from bare typed values to JSON-object DataValues.

### 3.1 Chat Start (`nodes/core/chat_start/executor.py`)

**Change `execute()` output** (line 41-43):

```python
# BEFORE:
return ExecutionResult(
    outputs={"message": DataValue(type="string", value=user_message)}
)

# AFTER:
return ExecutionResult(
    outputs={"output": DataValue(type="data", value={"message": user_message})}
)
```

**Output schema**: `{ "message": string }`

### 3.2 Agent (`nodes/core/agent/executor.py`)

**Change `execute()` input reading** (line 74):

```python
# BEFORE:
input_value = inputs.get("data", DataValue("string", "")).value

# AFTER:
input_dv = inputs.get("input", DataValue("data", {}))
input_value = input_dv.value if isinstance(input_dv.value, dict) else {"message": str(input_dv.value)}
```

**Change message extraction** (line 76-82):

```python
# BEFORE:
if isinstance(input_value, dict):
    message = input_value.get("content", str(input_value))
elif isinstance(input_value, list):
    message = input_value[-1].get("content", "") if input_value else ""
else:
    message = str(input_value) if input_value else ""

# AFTER:
# The data spine carries JSON dicts. Extract a message string from common fields.
if isinstance(input_value, dict):
    message = (
        input_value.get("message")
        or input_value.get("text")
        or input_value.get("response")
        or input_value.get("content")
        or str(input_value)
    )
else:
    message = str(input_value) if input_value else ""
```

**Change `execute()` success output** (line 111-113):

```python
# BEFORE:
yield ExecutionResult(
    outputs={"response": DataValue(type="string", value=content or "")}
)

# AFTER:
yield ExecutionResult(
    outputs={"output": DataValue(type="data", value={
        "response": content or "",
    })}
)
```

**Change `execute()` error output** (line 122-124) — same pattern, use `"output"` key and `type="data"`.

**`build()` method — no changes.** Phase 1 structural composition is unchanged.

**Output schema**: `{ "response": string }`

### 3.3 LLM Completion (`nodes/ai/llm_completion/executor.py`)

**Change `execute()` error output** (line 69-71):

```python
# BEFORE:
yield ExecutionResult(
    outputs={"text": DataValue(type="string", value=full_response)}
)

# AFTER:
yield ExecutionResult(
    outputs={"output": DataValue(type="data", value={"text": full_response})}
)
```

**Change `execute()` success output** (line 74-76) — same pattern.

**Output schema**: `{ "text": string }`

### 3.4 Prompt Template (Removed)

No executor changes required — the Prompt Template node has been removed. Use `{{ ... }}` expressions in node parameters for templating.

### 3.5 Conditional (`nodes/flow/conditional/executor.py`)

**Change input reading** (line 76):

```python
# BEFORE:
input_data = inputs.get("input", DataValue("json", None))

# AFTER:
input_data = inputs.get("input", DataValue("data", {}))
```

**Change output wrapping** — the Conditional passes through its input data as-is on the active branch. The output DataValues at lines 88, 93, 94 already pass `input_data` through, which is correct. Just ensure the `DataValue.type` stays as whatever it received (passthrough).

**Output schema**: passthrough (whatever came in on `input`).

### 3.6 Model Selector (`nodes/utility/model_selector/executor.py`)

**No changes to executor.** It outputs `DataValue(type="model", value=model)` on a typed side socket. This is correct — it's not on the data spine.

---

## Phase 4: Expression System Upgrade

### 4.1 New Expression Syntax

**Current**: `{{ input.fieldName }}` — resolves against the direct data input only.

**Target**: Two syntaxes, both supported:

1. `{{ $('Node Name').item.json.fieldPath }}` — reference any upstream node by display name
2. `{{ input.fieldPath }}` — shorthand for the direct parent's output (backward compat)

### 4.2 Rewrite `nodes/_expressions.py`

Replace the entire file. The new implementation needs:

**New regex patterns:**

```python
# Matches {{ $('Node Name').item.json.field.path }}
_NODE_REF_PATTERN = re.compile(
    r"\{\{\s*\$\(\s*['\"]([^'\"]+)['\"]\s*\)\.item\.json(?:\.([\w.]+))?\s*\}\}"
)

# Matches {{ input.field.path }} (backward compat shorthand)
_INPUT_PATTERN = re.compile(r"\{\{\s*input(?:\.([\w.]+))?\s*\}\}")
```

**New function signature:**

```python
def resolve_expressions(
    data: dict[str, Any],
    direct_input: DataValue | None,
    upstream_outputs: dict[str, Any],  # NEW: node_label -> output JSON blob
) -> dict[str, Any]:
```

- `direct_input`: The DataValue on the node's `"input"` handle (the direct parent's data).
- `upstream_outputs`: A dict mapping node display labels to their output JSON blobs. Built up by the engine as nodes execute.

**Resolution order within a string:**

1. Resolve `$('Node Name')` references first (look up in `upstream_outputs`)
2. Resolve `input.x` references second (look up in `direct_input.value`)

**Path resolution:** Reuse `_resolve_path()` (unchanged). For `$('Agent').item.json.response`, extract `"Agent"` as the node name, look up `upstream_outputs["Agent"]`, then resolve `"response"` against it.

**Edge cases:**

- Node name not found in `upstream_outputs` → resolve to empty string, log a warning
- Field path not found → resolve to empty string
- `{{ $('Node').item.json }}` (no field path) → stringify the entire output object
- Only process top-level string values in the data dict (unchanged from current behavior)

### 4.3 Update `backend/services/flow_executor.py`

**Add upstream output tracking.** After `port_values` (line 168), add:

```python
port_values: dict[str, dict[str, DataValue]] = {}
upstream_outputs: dict[str, Any] = {}  # NEW: node_label -> output JSON blob
```

**Derive node display labels.** The engine needs to map node IDs to display labels. After `nodes_by_id` (line 169), build a label map. Node definitions live in TypeScript, but the graph JSON sent from the frontend includes node `type` and `data`. The display label comes from:

1. `node.get("data", {}).get("label")` — user-set custom label (from the new `FlowNode.label` field, stored in `data`)
2. Fallback: the node type's default name. Since Python doesn't have the TS definition registry, pass a `node_type_names` mapping from the frontend in the graph JSON, OR hardcode a fallback map, OR have the frontend serialize the label into each node's `data.label` field before sending.

**Recommended approach**: The frontend already serializes node data into the graph JSON before sending it to the backend. Add `label` to each node object in the graph JSON. The `FlowProvider` in `context.tsx` should populate `node.data._label` with `definition.name` (the type's display name) when creating nodes, and let users override it.

For now, use this fallback in the engine:

```python
def _get_node_label(node: dict) -> str:
    """Get display label for expression resolution."""
    return (
        node.get("data", {}).get("_label")
        or node.get("data", {}).get("label")
        or node.get("type", "")
    )
```

**Populate `upstream_outputs` after each node executes.** At line 210, after `port_values[node_id] = item.outputs`:

```python
if isinstance(item, ExecutionResult):
    port_values[node_id] = item.outputs
    # Populate upstream outputs map for $() expressions
    label = _get_node_label(node)
    # Extract the data spine output as a JSON blob
    data_output = item.outputs.get("output") or item.outputs.get("true") or item.outputs.get("false")
    if data_output is not None:
        upstream_outputs[label] = data_output.value
```

**Handle duplicate labels:** If two nodes share a label, the second one overwrites. This is acceptable — the frontend should enforce unique labels (see Phase 6). Log a warning.

**Update the `resolve_expressions` call** (line 189-192):

```python
# BEFORE:
general_input = inputs.get("data")
if general_input is not None:
    data = resolve_expressions(data, general_input)

# AFTER:
direct_input = inputs.get("input")
data = resolve_expressions(data, direct_input, upstream_outputs)
```

Note: call `resolve_expressions` unconditionally — even without a direct input, `$()` references should still resolve from the upstream map.

### 4.4 Prompt Template (Removed)

Prompt templating now happens through the shared `{{ ... }}` expression system in node parameters. There is no separate Prompt Template executor or syntax to reconcile.

---

## Phase 5: Flow Engine — Data Spine Routing

### 5.1 `_gather_inputs()` — Skip Coercion for Data Spine

**Update `_gather_inputs()`** in `backend/services/flow_executor.py` (line 104-128). The coercion block should only apply to typed side socket edges, not data spine edges:

```python
def _gather_inputs(
    node_id: str,
    edges: list[dict],
    port_values: dict[str, dict[str, DataValue]],
) -> dict[str, DataValue]:
    """Pull DataValues from upstream output ports, coercing typed side sockets only."""
    inputs: dict[str, DataValue] = {}
    for edge in edges:
        if edge["target"] != node_id:
            continue
        source_outputs = port_values.get(edge["source"], {})
        value = source_outputs.get(edge.get("sourceHandle", "output"))
        if value is None:
            continue

        # Coerce ONLY for typed side socket edges (not data spine)
        target_type = (edge.get("data") or {}).get("targetType")
        if target_type and target_type != "data" and value.type != "data" and value.type != target_type:
            try:
                value = coerce(value, target_type)
            except TypeError:
                pass

        inputs[edge.get("targetHandle", "input")] = value
    return inputs
```

The key addition: `target_type != "data" and value.type != "data"` — if either end is the data spine, skip coercion entirely.

### 5.2 `_flow_edges()` — No Changes

The `_flow_edges()` filter (line 94-101) excludes edges where handles are `"agent"` or `"tools"`. This continues to work correctly — `data` spine edges use handles `"input"`/`"output"`/`"true"`/`"false"`, none of which are in `STRUCTURAL_HANDLE_TYPES`. Typed side socket edges (`"model"`, `"prompt"`, `"temperature"`, `"instructions"`) also pass through correctly.

### 5.3 Dead Branch Detection — No Changes

The dead branch detection (line 186-187) checks if a node has incoming flow edges but received no data. This works the same with data spine edges — if a conditional's `"false"` port is empty, downstream nodes connected to it get no inputs and are skipped.

### 5.4 `_pick_text_output()` in `streaming.py`

The `_pick_text_output()` function (streaming.py) tries to find the "answer" from a node's outputs by checking for `"output"`, then any string-typed value, then the first value. With standardized output port IDs, simplify:

```python
def _pick_text_output(outputs: dict[str, DataValue]) -> str | None:
    """Extract text from a node's data spine output."""
    data_output = outputs.get("output") or outputs.get("true") or outputs.get("false")
    if data_output is None:
        return None
    value = data_output.value
    if isinstance(value, dict):
        # Look for common text fields in the JSON blob
        return value.get("response") or value.get("text") or value.get("message") or str(value)
    return str(value) if value else None
```

---

## Phase 6: Frontend Changes

### 6.1 Node Labels for Expression Resolution

**`app/lib/flow/context.tsx`**: When creating nodes via `createFlowNode()` or `addNode()`, populate `data._label` with the node definition's `name`:

```typescript
// In addNode() or wherever createFlowNode is called:
const node = createFlowNode(type, position);
const definition = getNodeDefinition(type);
if (definition) {
  node.data._label = definition.name;
}
```

**Unique label enforcement**: If a label already exists in the graph, auto-suffix: `"Agent"`, `"Agent 1"`, `"Agent 2"`. The user can rename via the properties panel.

**Serialize labels into graph JSON**: When saving or sending the graph to the backend, each node's `data._label` is included. The backend uses this for `$()` expression resolution.

### 6.2 Socket Visual Differentiation

**`app/components/flow/socket.tsx`**: The data spine sockets should be visually distinct from typed side sockets. Options:

- Larger size for data sockets (e.g., `SIZE = 18` vs `14` for typed)
- Different shape (e.g., wide rectangle/pill vs circle/square/diamond)
- Or just use the `data` type's color (`#94a3b8` slate) which is already distinct

**Minimum change**: The `SOCKET_TYPES` entry for `data` already gives it a distinct color. The existing rendering pipeline handles this automatically — no socket.tsx changes required for MVP. Visual refinement (larger handles, different shape) can come later.

### 6.3 Edge Rendering

**`app/components/flow/canvas.tsx`**: Data spine edges could use a different visual treatment. The edge `data` already carries `sourceType` and `targetType`. If both are `"data"`, render differently (thicker, neutral color, etc.).

**Minimum change**: The existing `GradientEdge` uses the socket type's color for the gradient. Data spine edges will be `#94a3b8` (slate) on both ends — a neutral gray gradient. This is sufficient differentiation for MVP.

### 6.4 Node Rendering — Parameter Ordering

**`app/components/flow/node.tsx`**: The parameter rendering order should be:

1. Data spine I/O first (input/output with `type: 'data'`)
2. Structural sockets (agent, tools)
3. Hybrid config parameters (model, instructions, temperature)
4. Constants (name, description)

Currently parameters render in definition order (line 71-83). If definitions list data spine params first (which they do in our Phase 2 changes), this works automatically.

### 6.5 `getCompatibleNodeSockets()` — Data Spine Awareness

**`nodes/_registry.ts`** (line 66-103): When dragging a data spine wire, show ALL flow-capable nodes (any node with a `data` type socket), not just type-compatible ones:

The existing `canConnect()` already handles this — `canConnect('data', dataParam)` returns `true` because both sides are `'data'`. No special-casing needed in the registry function.

### 6.6 Connection Validation

**`app/lib/flow/context.tsx`** `isValidConnection()` (line 278-296): No changes needed — it already delegates to `canConnect()`, which we updated in Phase 1.2 to handle the `data` type.

---

## Phase 7: Test Updates

### 7.1 Frontend Tests

**`app/lib/flow/__tests__/sockets.test.ts`:**
- Add `'data'` to the `ALL_SOCKET_TYPES` array
- Add test: `canConnect('data', dataParam)` returns `true`
- Add test: `canConnect('data', stringParam)` returns `false` (cross-domain blocked)
- Add test: `canConnect('string', dataParam)` returns `false` (cross-domain blocked)
- Add test: `canCoerce('data', 'string')` returns `false`
- Existing coercion tests stay — they test side socket coercions which are unchanged

**`app/lib/flow/__tests__/node-contracts.test.ts`:**
- Add `'data'` to the `VALID_SOCKET_TYPES` array (line 5-8)

**`app/lib/flow/__tests__/registry.test.ts`:**
- Update `EXPECTED_NODE_IDS` to include all 8 node IDs

### 7.2 Python Tests

**`tests/test_flow_execution.py`:** Substantial updates needed.
- All stub executors must output `DataValue(type="data", value={...})` instead of `DataValue(type="string", value="...")`
- Edge construction via `make_edge()` must use `sourceHandle="output"`, `targetHandle="input"` for data spine edges
- Expression tests must use the new `$('Node Name')` syntax
- `_gather_inputs` test scenarios should verify coercion is skipped for data spine edges

**`tests/test_e2e_flow.py`:** Same pattern — update edges, DataValue types, expression syntax.

**`tests/test_flow_streaming.py`:** Update edge handles and DataValue types in stubs.

**`tests/nodes/test_flow_executors.py`:** Update DataValue types where executors are tested directly. Input keys change from `"data"` to `"input"`, output keys from `"text"`/`"message"`/`"response"` to `"output"`.

**`tests/nodes/test_coerce.py`:** No changes — coercion module is unchanged.

**`tests/test_graph_executor.py`:** No changes — structural (Phase 1) compilation is unchanged.

**`tests/conftest.py`:**
- Update `make_edge()` default handles. Currently defaults to `source_handle="agent", target_handle="agent"`. Add a helper or change defaults for data spine edges.
- Add a `make_data_edge(source, target)` helper that defaults to `sourceHandle="output"`, `targetHandle="input"`.

### 7.3 New Tests to Add

**Expression system tests** (new file `tests/nodes/test_expressions.py`):
- `$('Chat Start').item.json.message` resolves correctly
- Multiple `$()` references in one string
- Nested field access: `$('Agent').item.json.tokens_used.prompt`
- Non-existent node reference resolves to empty string
- Non-existent field resolves to empty string
- `{{ input.x }}` backward compat shorthand
- `{{ $('Node').item.json }}` without field path returns stringified object
- Duplicate node labels: second node's output overwrites first's

**Data spine routing tests** (add to `test_flow_execution.py`):
- Data spine edges pass JSON blobs without coercion
- Typed side socket edges still coerce (e.g., model wire)
- Mixed graph: data spine + typed side sockets both work correctly
- Node output shapes: each node produces correct JSON structure
- `upstream_outputs` map populated correctly for `$()` resolution

---

## File Change Summary

### Files that CHANGE

| File | Change Level | Summary |
|------|-------------|---------|
| `nodes/_types.ts` | Medium | Add `'data'` to SocketTypeId/ParameterType, add DataParameter, add FlowNode.label |
| `app/lib/flow/sockets.ts` | Small | Add `data` to SOCKET_TYPES, update canConnect() |
| `nodes/core/chat_start/definition.ts` | Small | message(string) output → output(data) |
| `nodes/core/chat_start/executor.py` | Small | Output key + DataValue type change |
| `nodes/core/agent/definition.ts` | Small | data(json) input → input(data), response(string) output → output(data), remove acceptsTypes |
| `nodes/core/agent/executor.py` | Medium | Input extraction, output wrapping |
| `nodes/ai/llm_completion/definition.ts` | Small | data(json) input → input(data), text(string) output → output(data) |
| `nodes/ai/llm_completion/executor.py` | Small | Output key + DataValue type change |
| `nodes/flow/conditional/definition.ts` | Small | Remove redundant input socket, change types to data |
| `nodes/flow/conditional/executor.py` | Small | Input key change, DataValue type change |
| `nodes/utility/model_selector/definition.ts` | Tiny | Change executionMode to structural |
| `nodes/_expressions.py` | Large | Full rewrite — new regex, new signature, $() support |
| `backend/services/flow_executor.py` | Medium | upstream_outputs map, expression call update, coercion bypass |
| `app/lib/flow/context.tsx` | Small | Populate _label on node creation |

### Files that DON'T change

| File | Why |
|------|-----|
| `nodes/_types.py` | DataValue already supports any type string |
| `nodes/_coerce.py` | Coercion table unchanged — scoped to side sockets |
| `nodes/_registry.py` | Auto-discovery unchanged |
| `nodes/_registry.ts` | Imports + lookups unchanged (definitions change, not the registry) |
| `nodes/tools/mcp_server/*` | Structural only, no data spine |
| `nodes/tools/toolset/*` | Structural only, no data spine |
| `backend/services/graph_executor.py` | Phase 1 structural build unchanged |
| `app/lib/flow/index.ts` | Barrel re-exports — picks up changes automatically |
| `app/components/flow/controls/*` | Inline controls unaffected |
| `app/components/flow/properties-panel.tsx` | Properties panel unaffected |

---

## Implementation Order

Execute in this order. Each phase is independently testable.

1. **Phase 1** (Type System) — Add `data` type. Run `bun run build` to verify frontend compiles.
2. **Phase 2** (Node Definitions) — Update all definition.ts files. Build still passes.
3. **Phase 3** (Executors) — Update all executor.py files. Backend still starts.
4. **Phase 4** (Expression System) — Rewrite `_expressions.py`, update flow executor calls. Run expression tests.
5. **Phase 5** (Flow Engine) — Update `_gather_inputs()` coercion bypass. Run flow execution tests.
6. **Phase 6** (Frontend) — Node labels, visual tweaks. Manual testing in the editor.
7. **Phase 7** (Tests) — Update existing tests, add new tests. Full test suite passes.

Phases 1-3 can be done as a single commit. Phase 4 is the most complex and should be its own commit. Phases 5-7 round it out.

---

## Verification Checklist

After all changes:

- [ ] `bun run build` passes
- [ ] `bun run lint` passes
- [ ] Backend starts without errors (`bun run backend`)
- [ ] All existing tests pass with updates
- [ ] New expression tests pass
- [ ] Manual test: Create graph Chat Start → Agent. Chat works. Response appears.
- [ ] Manual test: Create graph Chat Start → Passthrough → LLM Completion. Data flows through.
- [ ] Manual test: Wire a Model node to two Agent nodes via typed side sockets. Both agents use the model.
- [ ] Manual test: Use `{{ $('Chat Start').item.json.message }}` in an Agent's instructions field. It resolves.
- [ ] Manual test: Conditional node routes to correct branch. Dead branch is skipped.
- [ ] Data spine wires render with the neutral slate color
- [ ] Typed side socket wires render with their respective colors
- [ ] Add-node menu shows compatible nodes when dragging data spine wires
