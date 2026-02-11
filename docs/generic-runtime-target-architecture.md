# Generic Graph Runtime - Target Architecture and Implementation Plan

Status: active implementation

Last updated: 2026-02-11

## Purpose

This document defines the target runtime architecture and a concrete migration plan for graph execution.

Primary goal: **one generic runtime kernel** that can execute arbitrary custom nodes without hardcoded knowledge of agents, tools, or specific handle names.

## Desired End State

1. All chat entrypoints execute through one graph runtime path.
2. Runtime kernel is domain-agnostic (no agent/tool special-casing).
3. Node semantics live in node executors (`execute`, optional `materialize`).
4. Link dependencies are resolved by generic runtime APIs, not prebuild phases.
5. Frontend event behavior remains stable for streaming UX.

## Current State (What Is Already Done)

### In good direction

- Chat command routing has been unified through graph runtime orchestration:
  - `backend/commands/streaming.py`
  - `backend/commands/branches.py`
  - `backend/services/chat_graph_runner.py`
- Legacy prebuild/factory modules were removed:
  - `backend/services/graph_executor.py` (deleted)
  - `backend/services/agent_factory.py` (deleted)
- Edge channel metadata is now represented in editor-side graph edges:
  - `app/lib/flow/context.tsx`
  - `nodes/_types.ts`
- Graph normalization exists and enforces strict channel validation:
  - `backend/services/graph_normalizer.py`

### Still not at target

- Runtime API exists as protocol only; no concrete runtime service is implemented:
  - `nodes/_types.py` (`RuntimeApi`)
- No node currently implements `materialize(...)`.
- Agent execution still relies on `context.agent` fallback instead of runtime link resolution:
  - `nodes/core/agent/executor.py`
- Flow kernel still has domain assumptions (`chat-start` rooted active subgraph):
  - `backend/services/flow_executor.py`
- `extra_tool_ids` is currently ignored in graph runtime entrypoint:
  - `backend/services/chat_graph_runner.py`

## Non-Negotiable Architecture Rules

1. Runtime kernel must not branch on node type (no `if node_type == "agent"`).
2. Runtime kernel must not branch on handle names (no hardcoded `"tools"` behavior).
3. Runtime kernel handles only:
   - graph traversal
   - input routing
   - execution scheduling
   - generic link resolution
   - caching and cycle detection
4. Domain behavior (agent/team/tool semantics) belongs in node executors.
5. Chat persistence and stream protocol belong in adapter/command layer, not kernel.

## Runtime Contract (Target)

### Node capability model

- `execute(data, inputs, context)`
  - Processes flow values.
  - Returns `ExecutionResult` or async stream of `NodeEvent` + `ExecutionResult`.
- `materialize(data, output_handle, context)` (optional)
  - Produces link artifacts for downstream nodes.
  - Artifact type is opaque to runtime.

### Context model

`FlowContext` should converge to:

- `node_id`
- `chat_id`
- `run_id`
- `state`
- `runtime` (required)
- `services` (dependency bag)

Compatibility fields (`agent`, `tool_registry`) should be removed after node migration.

## Implementation Work Plan

## Workstream A - Build the generic runtime service

Create `backend/services/graph_runtime.py` with concrete implementation for:

- node lookup
- indexed incoming/outgoing edge queries by channel
- `resolve_links(node_id, target_handle)`
- per-run cache (`cache_get/cache_set`)
- link cycle detection with helpful path diagnostics

Then inject this runtime into flow execution context in `backend/services/flow_executor.py`.

### Required changes

- Add `GraphRuntime` implementation file.
- Update flow engine to use runtime service for graph lookups.
- Keep flow engine generic; do not add node-type-specific behavior.

## Workstream B - Migrate structural behavior to `materialize`

Replace build-only structural path with runtime link materialization.

### Required changes

- Implement `materialize(...)` in:
  - `nodes/tools/toolset/executor.py`
  - `nodes/tools/mcp_server/executor.py`
- Optional temporary compatibility: keep `build()` for test migration only, then delete.
- Remove dependency on `BuildContext`, `ToolsResult`, `AgentResult`, `MetadataResult` once migrated.

## Workstream C - Refactor agent node to runtime self-resolution

Agent node must resolve dependencies through runtime link APIs.

### Required changes

- In `nodes/core/agent/executor.py`:
  - Stop reading `context.agent`.
  - Resolve linked dependencies via `context.runtime.resolve_links(...)`.
  - Implement `materialize(...)` for reusable runnable artifacts.
  - Keep `execute(...)` for pipeline execution.
- Support both patterns:
  - sequential pipeline (`agent -> agent` on flow channel)
  - composition (`child agent/tool providers -> parent agent` on link channel)

## Workstream D - Remove domain assumptions from flow kernel

### Required changes

- Remove `chat-start` rooted active-subgraph filtering from `backend/services/flow_executor.py`.
- Kernel should execute based on generic graph/channel rules only.
- If entrypoint filtering is needed for chat UX, do it in chat adapter layer, not kernel.

## Workstream E - Chat adapter parity and run control

`backend/services/chat_graph_runner.py` remains adapter boundary and must preserve UI event contract.

### Required changes

- Keep event parity for:
  - `RunContent`
  - reasoning events
  - tool call events
  - member run events
  - approvals
  - cancellation
- Ensure graph runtime path participates in run-control lifecycle (active run registration, cancel, approval state).
- Re-enable tool selection wiring (`extra_tool_ids`) through runtime/node semantics.

## Critical Risk: Contract Mismatch (Must Fix)

There is a strict mismatch that can break autosave/load/runtime boundaries.

### Current mismatch

- `backend/services/graph_normalizer.py` requires valid `edge.data.channel` for every edge.
- `backend/commands/agents.py` allows `GraphEdge.data` to be optional and `channel` optional.

This means API payloads can pass validation while normalizer later rejects them.

### Failure mode

1. Client sends/saves graph edge without `data.channel`.
2. Command schema accepts it.
3. Save/load/runtime normalization raises `ValueError` on invalid channel.
4. User sees hard failure in autosave or run path.

### Required fix

1. Make channel required at API boundary for edges.
   - Update `backend/commands/agents.py` edge schema so `data.channel` is required.
2. Ensure frontend always sends channel on edge creation and graph serialization.
   - `app/lib/flow/context.tsx`
3. Keep strict fail-fast in normalizer (do not silently infer).
4. Add contract tests that reject missing channel payloads explicitly.

## Test Plan (Required)

1. Generic runtime tests with fake custom nodes (non-agent/tool naming) proving no kernel coupling.
2. Link resolution tests:
   - nested dependencies
   - cache hits
   - cycle detection
3. Event characterization parity tests for chat adapter:
   - existing `tests/test_chat_runtime_characterization.py`
   - existing `tests/test_branch_runtime_characterization.py`
4. API contract tests for edge channel strictness.
5. Command-level tests for submit/retry/continue/edit cancellation and approvals.

## Definition of Done

All items must be true:

1. Runtime kernel has no node-type or handle-name special-casing.
2. `GraphRuntime` exists and is used by flow execution.
3. `materialize` is implemented and used for link dependencies.
4. Agent node self-resolves at runtime; no `context.agent` dependency.
5. Edge channel contract is strict and consistent across FE schema, API schema, and normalizer.
6. Chat stream event behavior remains compatible with current frontend processors.
7. Legacy build-phase types and compatibility shims are removed.

## Practical Review Checklist

Use this checklist in each PR:

- [ ] No runtime `if node_type == ...` logic added.
- [ ] No runtime logic keyed on specific handle names.
- [ ] New node behavior implemented in executor, not kernel.
- [ ] Edge channel contract preserved end-to-end.
- [ ] Characterization tests stay green.
- [ ] Cancellation/approval behavior verified on graph runtime path.
