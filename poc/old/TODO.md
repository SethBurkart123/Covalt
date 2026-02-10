# Flow Architecture — Implementation TODO

Changes needed to align the codebase with `flow-architecture.md`.

## Phase 1: Type System Cleanup

Trim the 16 socket types down to 9. Remove dead types, rename `message` to `messages`, add `model` as a connectable socket type.

### 1.1 — `nodes/_types.ts`

- **Remove** from `SocketTypeId`: `color`, `text`, `binary`, `array`, `document`, `vector`, `trigger`, `any`
- **Rename** `message` to `messages`
- **Add** `model` to `SocketTypeId`
- **Remove** `ColorParameter` interface and `'color'` from `ParameterType`
- **Remove** `'color'` from the `Parameter` union type

### 1.2 — `app/lib/flow/sockets.ts`

- **Remove** entries from `SOCKET_TYPES` registry: `color`, `text`, `binary`, `array`, `document`, `vector`, `trigger`, `any`
- **Rename** `message` entry to `messages`
- **Add** `model` entry with color and shape
- **Update** `IMPLICIT_COERCIONS`:
  - Remove: `string:text`, `text:string`, `json:text`, `message:text`, `message:string`, `message:json`, `document:text`, `document:json`
  - Add: `string:messages` (wrap as user message array), `messages:string` (extract last content), `json:messages` (extract messages field or wrap)
- **Update** `canCoerce()`: remove `any` special-casing
- **Update** `canConnect()`: no changes needed (logic is generic)

### 1.3 — `nodes/_coerce.py`

- **Remove** converter functions: `_json_to_text`, `_message_to_text`, `_document_to_text`, `_document_to_json`
- **Rename** `_message_to_string` and `_message_to_json` to handle arrays (plural `messages`)
- **Add** converter: `_string_to_messages` (wraps as `[{role: "user", content: text}]`)
- **Add** converter: `_messages_to_string` (extracts last message content from array)
- **Update** `COERCION_TABLE`: remove all entries with `text`, `document`, `any`; add new `string`/`messages` entries
- **Update** `can_coerce()`: remove `any` special-casing
- **Update** `coerce()`: remove `any` special-casing

### 1.4 — Node definitions (socket type fixes)

**`nodes/core/agent/definition.ts`:**
- Change `input` socket type from `text` to `string`
- Change `input` acceptsTypes from `['text', 'string', 'message']` to `['string', 'messages']`
- Change `response` socket type from `text` to `string`
- Change `model` mode from `constant` to `hybrid`, add socket config `{type: 'model'}`
- Change `instructions` mode from `constant` to `hybrid`, add socket config `{type: 'string', side: 'left'}`
- Add `temperature` parameter: type `float`, mode `hybrid`, default `0.7`, min `0`, max `2`, step `0.1`, socket `{type: 'float', side: 'left'}`

**`nodes/core/chat_start/definition.ts`:**
- Change `message` socket type from `message` to `string`

**`nodes/ai/llm_completion/definition.ts`:**
- Change `prompt` socket type from `text` to `string`
- Change `text` (output) socket type from `text` to `string`
- Change `model` mode from `constant` to `hybrid`, add socket config `{type: 'model', side: 'left'}`
- Change `temperature` mode from `constant` to `hybrid`, add socket config `{type: 'float', side: 'left'}`

**`nodes/ai/prompt_template/definition.ts`:**
- Change `text` (output) socket type from `text` to `string`

**`nodes/flow/conditional/definition.ts`:**
- Change `input` socket type from `any` to `json`
- Change `true` output socket type from `any` to `json`
- Change `false` output socket type from `any` to `json`

### 1.5 — Node executors (DataValue type fixes)

**`nodes/core/agent/executor.py`:**
- Change output DataValue type from `text` to `string` (line 109, 120)
- Change input fallback DataValue type from `text` to `string` (line 74)

**`nodes/core/chat_start/executor.py`:**
- Change output DataValue type from `message` to `string`
- Change output value from `{role: "user", content: msg}` to just the message string

**`nodes/ai/llm_completion/executor.py`:**
- Change output DataValue type from `text` to `string` (lines 70, 75)
- Change input fallback DataValue type from `text` to `string` (line 27)

**`nodes/ai/prompt_template/executor.py`:**
- Change output DataValue type from `text` to `string` (line 38)

**`nodes/flow/conditional/executor.py`:**
- Change input fallback DataValue type from `any` to `json` (line 76)

### 1.6 — Tests

**`app/lib/flow/__tests__/sockets.test.ts`:**
- Update `ALL_SOCKET_TYPES` array to match new 9-type set
- Remove test cases involving `text`, `document`, `binary`, `vector`, `trigger`, `any`
- Add test cases for `string` -> `messages` coercion
- Add test cases for `messages` -> `string` coercion
- Update `incompatiblePairs` to remove `color`
- Update `validCoercions` to match new table

**`app/lib/flow/__tests__/node-contracts.test.ts`:**
- Update `VALID_SOCKET_TYPES` array to match new 9-type set

**`tests/nodes/test_coerce.py`:**
- Remove all `text`, `document`, `any` test cases
- Rename `message` tests to `messages` with array semantics
- Add `string` -> `messages` coercion test
- Add `messages` -> `string` coercion test

**`tests/nodes/test_flow_executors.py`:**
- Update DataValue types in test fixtures from `text` to `string`

**`tests/test_flow_execution.py`:**
- Update stub executors that use `text` DataValue type to use `string`
- Update `message` references to `string` (Chat Start stubs)

### 1.7 — Registry

**`nodes/_registry.ts`:**
- No structural changes needed (imports stay the same)

---

## Phase 2: New Features ✓

### 2.1 — General input (data pipe) ✓

Every flow node gets a general `json` input socket on its left side. This is the main data pipe from upstream. Any parameter can reference fields from it via expressions.

- ✓ Added `data` parameter (type `json`, mode `input`) to: Agent, LLM Completion, Conditional
- ✓ Prompt Template already had a `data` input
- ✓ The general input is accessible via expressions in any parameter

### 2.2 — Expression system ✓ (backend only)

The `{{input.fieldName}}` syntax for referencing upstream data in any text-like parameter.

- ✓ Backend: `nodes/_expressions.py` — `resolve_expressions()` handles `{{input.field}}` syntax
- ✓ Integrated into `backend/services/flow_executor.py` — resolves before calling executors
- ✓ Priority chain: Wire > Expression > Inline value
- ☐ Frontend: expression toggle/input in hybrid/constant text parameters (future)

### 2.3 — Wire the flow engine into streaming ✓

- ✓ Created `handle_flow_stream()` in `backend/commands/streaming.py`
- ✓ Maps `NodeEvent` → `ChatEvent` for WebSocket (FlowNodeStarted, RunContent, FlowNodeCompleted, RunError)
- ✓ Handles streaming tokens (progress events), final output capture, content block saving
- ✓ Wired into both `stream_chat()` and `stream_agent_chat()` — flow graphs branch to `handle_flow_stream`, structural-only graphs fall through to `handle_content_stream`
- ✓ 5 integration tests in `tests/test_flow_streaming.py`

### 2.4 — Model node ✓

- ✓ Created `nodes/utility/model_selector/definition.ts` — `model` type hybrid input + `model` type output
- ✓ Created `nodes/utility/model_selector/executor.py` — passes model string through
- ✓ Registered in `nodes/_registry.ts`
