# Graph Runtime V2 Playbook (Pre-Beta)

Status: active implementation

Last updated: 2026-02-12

---

## Purpose

This document captures the target runtime architecture we agreed on and the exact implementation work needed to finish it.

Primary goal: **one generic runtime kernel** that can execute arbitrary custom nodes without hardcoded knowledge of agents, tools, or special handle names.

This is pre-beta. We optimize for clean architecture and correctness over backwards compatibility.

---

## Final Architecture (Target)

### 1) One execution path for chat

All chat entrypoints execute through the same graph runtime path:

- `stream_chat`
- `stream_agent_chat`
- `continue_message`
- `retry_message`
- `edit_user_message`

No direct alternate "agent-only" runtime path.

### 2) Runtime kernel is generic

Runtime core knows only graph primitives:

- nodes
- handles/ports
- edges
- channels (`flow`, `link`)
- scheduling
- value routing
- dependency materialization

Runtime core must not branch on domain concepts (agent/tool/chat-start).

### 3) Node executors own domain behavior

Node behavior lives in node executors:

- `execute(...)` for flow behavior
- optional `materialize(...)` for link artifact production

If behavior is domain-specific (agents, teams, tools, memory), it belongs in executors and adapter services, not runtime core.

### 4) Edges carry explicit channel metadata

Every edge must include `data.channel`:

- `flow`: runtime `DataValue` routing
- `link`: dependency/materialization wiring

No implicit fallback at persistence/runtime boundaries.

---

## Runtime/Node Contracts

### Runtime API (generic)

Runtime interface should stay capability-oriented:

- `get_node(node_id)`
- `incoming_edges(node_id, channel=?, target_handle=?)`
- `outgoing_edges(node_id, channel=?, source_handle=?)`
- `resolve_links(node_id, target_handle)`
- `materialize_output(node_id, output_handle)`
- `cache_get/cache_set`

Do not add domain helpers like `resolve_tools_for_agent`.

### Node capabilities

- `execute(data, inputs, context)`
  - receives routed flow inputs
  - returns `ExecutionResult` or async stream of `NodeEvent` + `ExecutionResult`
- `materialize(data, output_handle, context)`
  - returns opaque artifact for link consumers
  - runtime does not interpret artifact shape

### FlowContext

`FlowContext` should carry:

- `node_id`
- `chat_id`
- `run_id`
- `state`
- `runtime`
- `services`

Domain dependencies (tool registry, run control bridge, chat input scope) must be in `services`.

---

## Chat Execution Semantics (Required)

This is the critical policy for multi-agent correctness.

### A) Pipeline vs composition

- **Pipeline**: flow edge (`flow`) between agents means sequential execution (A -> B).
- **Composition**: link edge (`link`) into agent `tools` means dependency/member composition.

Both must coexist in one graph.

### B) Entry agent vs downstream agent input

- Entry agents (first agent stage for user chat path) may consume full chat history/messages.
- Downstream pipeline agents must consume upstream flow payload, not full chat history.

### C) includeUserTools policy

- `includeUserTools` from chat-start must be respected for entry agents, even if there are intermediate flow nodes.
- This policy must not depend on a direct `chat-start -> agent` edge.

### D) Cancel semantics

- Cancel intent must survive timing races.
- Cancel before run registration should still cancel once run is bound.

---

## Current Progress (Already Done)

These are in good direction and should be kept:

- Graph runtime path is used by chat and branch commands.
- Legacy `graph_executor`/`agent_factory` phase-1 path is removed.
- `GraphRuntime` exists with link resolution and cycle detection.
- Structural nodes now implement `materialize(...)`.
- Agent node builds at runtime (execute/materialize).
- `FlowContext.services` exists for dependency injection.

---

## Remaining Issues (Priority)

## P0 - correctness

1. **Pipeline input semantics are incorrect**
   - Current agent execution can still prefer global chat messages for downstream agents.
   - Downstream agents must run on upstream flow payload.

2. **`includeUserTools` can be misapplied**
   - Current check depends on direct upstream `chat-start` edge.
   - Fails when chat-start feeds intermediate nodes first.

3. **Disconnected flow nodes can execute**
   - Runtime currently schedules all flow-capable nodes.
   - Chat runs should only execute reachable subgraph from explicit entry nodes.

4. **Cancel race before active run registration**
   - Cancel can return false if run not registered yet.
   - Must persist early intent and apply once registered.

## P1 - architecture hygiene

5. **Edge channel strictness mismatch at boundaries**
   - API schema should enforce `flow|link` (not generic string).
   - Editor should not silently patch missing channel on save/load boundaries.

6. **Node lifecycle event consistency**
   - Started/completed emission is inconsistent between sync and streaming executors.
   - Define one lifecycle contract and enforce it.

## P2 - cleanup

7. Compatibility wrappers and dead code in streaming adapter can be trimmed once parity tests are stable.

---

## Implementation Plan

### Phase 1: Fix multi-agent chat semantics

Files:

- `backend/services/chat_graph_runner.py`
- `nodes/core/agent/executor.py`

Work:

1. Add a chat-scope service object in `context.services` (e.g. `chat_scope`) that provides:
   - `is_entry_agent(node_id) -> bool`
   - `include_user_tools(node_id) -> bool`

2. Build chat scope in `chat_graph_runner` from graph flow topology:
   - Identify entry agents (no upstream agent in flow ancestry on active chat path)
   - Compute include-user-tools policy from upstream chat-start nodes

3. Update agent executor input resolution:
   - If `chat_scope.is_entry_agent(node_id)` and `chat_input.agno_messages` exists: run with chat history
   - Otherwise: run with upstream flow payload only

4. Update extra tool inclusion:
   - Replace direct upstream `chat-start` check with `chat_scope.include_user_tools(node_id)`

Acceptance:

- `chat-start -> agent A -> agent B` uses full chat history only for A, pipeline payload for B.
- `includeUserTools=false` is respected even with intermediate flow nodes.

### Phase 2: Restrict chat runs to active subgraph

Files:

- `backend/services/flow_executor.py`
- `backend/services/chat_graph_runner.py`

Work:

1. Add optional runtime execution scope in services (e.g. `services.execution.entry_node_ids`).
2. In `run_flow`, when entry nodes are provided, execute only nodes reachable via `flow` edges from those entries.
3. Topological sort and cycle checks apply to that filtered subgraph only.

Acceptance:

- Disconnected nodes do not execute in chat runs.
- Cycles in unreachable subgraphs do not fail chat runs.

### Phase 3: Make cancel race-proof

Files:

- `backend/commands/streaming.py`
- `backend/services/run_control.py`
- `backend/services/chat_graph_runner.py`

Work:

1. If cancel arrives before active run exists, store early cancel intent and return success.
2. Apply intent when run handle/run id binds.
3. Keep behavior consistent for flow runtime and any remaining legacy handlers.

Acceptance:

- Cancel before registration, after registration, and during approvals all behave correctly.

### Phase 4: Enforce strict channel contract end-to-end

Files:

- `backend/commands/agents.py`
- `app/contexts/agent-editor-context.tsx`
- `app/lib/flow/context.tsx`

Work:

1. Constrain backend edge channel type to `Literal["flow", "link"]`.
2. Keep strict fail-fast in normalizer.
3. Ensure editor always writes channel on edge creation.
4. Remove silent patching of missing channel at save/load boundaries (except explicit migration code if intentionally added).

Acceptance:

- Missing/invalid channel is rejected at API boundary.
- New edges always persist valid channel.

### Phase 5: Standardize node lifecycle events

Files:

- `backend/services/flow_executor.py`
- streaming executors that currently emit lifecycle events directly

Work:

1. Define contract: one `started`, one terminal (`completed` or `error` or `cancelled`) per executed node.
2. Runtime emits lifecycle wrapper events consistently for both sync and async executors.
3. Executors keep domain/progress events only.

Acceptance:

- Event stream is deterministic and UI-safe.

---

## Guardrails (Do Not Regress)

- No `if node_type == "agent"` in runtime core.
- No hardcoded handle-name logic in runtime core.
- No fallback to prebuild root-agent phases.
- No implicit channel inference in backend persistence/runtime boundaries.

---

## Testing Checklist

Run before merge:

- `uv run pytest`
- `bun run lint`

Must include assertions for:

- entry vs downstream agent input behavior
- includeUserTools through intermediate nodes
- active-subgraph execution only
- cancel before/after registration
- link dependency cycle diagnostics
- strict edge channel validation
- chat event protocol parity with stream processor

---

## Suggested PR Slices

1. Chat scope + agent input/tool policy fix
2. Active-subgraph filtering in runtime
3. Cancel race hardening
4. Channel contract strictness end-to-end
5. Lifecycle event normalization + cleanup

Each PR should include targeted tests and keep behavior changes narrowly scoped.

---

## Definition of Done

This effort is complete when all are true:

1. All chat execution paths use one graph runtime path.
2. Runtime core remains domain-agnostic.
3. Multi-agent pipeline semantics are correct (entry vs downstream behavior).
4. includeUserTools policy is topology-robust.
5. Cancel semantics are race-safe.
6. Edge channel contract is strict and consistent FE/API/runtime.
7. Test suite passes with explicit coverage of the above.
