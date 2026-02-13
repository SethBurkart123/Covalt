# Graph Runtime V2 Playbook (Pre-Beta)

Status: active implementation

Last updated: 2026-02-13

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

This section is about *dataflow*, not hidden policy. The runtime does not decide
what counts as "entry" or "downstream"; nodes consume exactly what the graph
routes into them.

### A) Pipeline vs composition

- **Pipeline**: flow edge (`flow`) between agents means sequential execution (A -> B).
- **Composition**: link edge (`link`) into agent `tools` means dependency/member composition.

Both must coexist in one graph.

### B) Message inputs are explicit and user-controlled

- Agent nodes consume whatever message payload is present in their **input** value.
- Default behavior should be implemented as a **node data expression** that reads
  the chat-start output (e.g. `{{ input.agno_messages }}` or `{{ input.history }}`).
- Users can override this expression to pull from any upstream node or to supply
  a manually authored message list.
- The agent node should accept both the agno message format (chat-start output)
  and OpenAI-compatible message arrays.

### C) includeUserTools is dataflow, not topology

- `includeUserTools` should be carried as input data (from chat-start or any
  upstream node) and interpreted by the agent node.
- No topology heuristics ("is entry agent") and no runtime lookups.

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
- Flow execution can be scoped to an active subgraph via `services.execution.entry_node_ids`.

---

## Remaining Issues (Priority)

## P0 - correctness

1. **Message inputs are not fully explicit or user-editable**
   - Agent nodes should accept a message-list input configured by expressions or manual UI.
   - Default should point at chat-start output but must be editable by the user.

2. **`includeUserTools` should be driven by input data**
   - Move tool inclusion policy into the agent node input data path.
   - Remove topology-based heuristics and service lookups.

3. **Cancel race before active run registration**
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

### Phase 1: Make message inputs user-controlled

Files:

- `backend/services/chat_graph_runner.py`
- `nodes/core/agent/executor.py`

Work:

1. Add a message-list input shape to the agent node schema (and default data expression).
   - Default expression pulls from chat-start output (e.g. `{{ input.agno_messages }}`).
   - Allow users to override with any expression or manual message list.

2. Extend expression evaluation to work for nested structures, not just strings,
   so message arrays can contain embedded expressions.

3. Update agent executor to accept:
   - agno-style messages (chat-start output)
   - OpenAI-compatible message arrays
   - a single message string fallback

4. Drive `includeUserTools` from input data, not topology.
   - This can be a boolean field in the same input payload or an expression
     authored by the user.

Acceptance:

- Agent node uses only its input payload for messages.
- Default graph behavior still uses chat-start output without any runtime heuristics.
- User overrides work for both expression and manual message list modes.

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

- expression-driven message inputs (default + overridden)
- manual message list mode (with embedded expressions)
- includeUserTools driven by input data
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
