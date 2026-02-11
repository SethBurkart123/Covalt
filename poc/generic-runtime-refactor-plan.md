# Generic Runtime Refactor Plan

Status: in progress

Owner: backend + graph runtime

Scope: unify execution architecture so runtime is domain-agnostic and nodes own their own behavior.

---

## Directional Focus Update (2026-02-11)

We are choosing correctness and architectural consistency over backward compatibility during this migration.

- No compatibility shims for legacy graph edge semantics.
- No runtime fallback branches for old execution paths when a graph runtime path exists.
- Strict graph schema at runtime boundaries (invalid edge metadata fails fast).

The goal is to converge quickly on the target architecture, not prolong hybrid behavior.

---

## 1) Executive Summary

We are moving from a mixed architecture (Phase 1 pre-build + Phase 2 flow run, plus multiple chat execution paths) to a single, capability-driven runtime.

The key conceptual shift is this:

- Runtime core handles only generic graph concerns: ordering, input routing, execution, events, caching, and cancellation hooks.
- Runtime core does not know what an Agent is, what a Tool is, or what any specific handle name means.
- Node executors define semantics through capabilities (`execute`, `materialize`) and port contracts.
- Chat behavior (SSE/WebSocket message protocol, persistence format, approval UX, cancellation semantics) lives in a chat adapter layer, not in the runtime kernel.

This gives us a runtime that scales to arbitrary custom nodes without changing core engine logic.

---

## 2) Why This Change Is Necessary

### Current pain points

1. Runtime is still partially coupled to agent/tool semantics.
   - Example: `backend/services/flow_executor.py` still hardcodes Chat Start rooted subgraph selection.
2. There are multiple execution paths.
   - All chat entrypoints now route through graph runtime.
   - Remaining duplication is mostly command-side message lifecycle/error persistence glue.
3. Node API is inconsistent.
   - Agent node has `execute()` but much of logic is effectively prebuilt in separate services in current architecture.
4. Multi-agent pipeline semantics are fragile.
   - Prebuilding one root runnable conflicts with graphs that contain multiple agent nodes in sequence.
5. Edge metadata does not round-trip end-to-end.
   - Current API and autosave boundaries do not preserve edge `data` payloads, which blocks channel metadata migration.

### Strategic problem

As long as runtime knows special domain handles/nodes, adding new custom node categories will keep requiring runtime edits. That is the opposite of a dynamic node system.

---

## 3) Design Principles (Non-Negotiable)

1. Runtime is generic.
   - No `if node_type == ...` in runtime core.
   - No hardcoded handle names in runtime core.
2. Nodes own semantics.
   - Domain meaning is implemented in node executors.
3. Capabilities over inheritance.
   - A node can implement `execute`, `materialize`, or both.
4. One execution pipeline.
   - All user chat actions use one graph runner.
5. Strict graph contracts.
   - Graphs must satisfy current schema (`edge.data.channel`) and fail fast when invalid.
6. Event contract stability.
   - Frontend stream processor behavior stays stable during migration.

---

## 4) Target Architecture

## 4.1 Layers

1. Runtime Kernel (generic)
   - `backend/services/flow_executor.py` (refactored)
   - `backend/services/graph_runtime.py` (new)
2. Node Executors (domain-specific)
   - `nodes/**/executor.py`
3. Adapters
   - `backend/services/chat_graph_runner.py` (new)
   - optional future adapters (webhook, CLI, batch)
4. Commands
   - `backend/commands/streaming.py`
    - `backend/commands/branches.py`
    - thin wrappers over adapter APIs
5. Graph normalization boundary
   - `backend/services/graph_normalizer.py` (new, extracted from current `agent_manager` edge normalization behavior)

## 4.2 Node capability model

- `execute(data, inputs, context)`
  - Processes flow values.
  - Emits `NodeEvent` and final `ExecutionResult`.
- `materialize(data, output_handle, context)` (optional)
  - Produces a non-flow artifact for link/dependency edges.
  - Example artifact: callable, runnable object, config object, connector, etc.

Runtime does not care what artifacts are.

## 4.3 Edge channels

Every edge is categorized by channel, not by node type/handle name.

- `flow`: routed through `_gather_inputs` into `execute()`.
- `link`: resolved on-demand via runtime dependency resolution into `materialize()`.

Edge channel is stored in edge metadata (`edge.data.channel`) and required by runtime boundaries.

---

## 5) New Core Contracts

## 5.1 Python runtime contracts (`nodes/_types.py`)

```python
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


@dataclass
class DataValue:
    type: str
    value: Any


@dataclass
class NodeEvent:
    node_id: str
    node_type: str
    event_type: str
    run_id: str = ""
    data: dict[str, Any] | None = None


@dataclass
class ExecutionResult:
    outputs: dict[str, DataValue]
    events: list[NodeEvent] = field(default_factory=list)


class RuntimeApi(Protocol):
    def get_node(self, node_id: str) -> dict[str, Any]: ...
    def incoming_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        target_handle: str | None = None,
    ) -> list[dict[str, Any]]: ...
    def outgoing_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        source_handle: str | None = None,
    ) -> list[dict[str, Any]]: ...
    async def resolve_links(self, node_id: str, target_handle: str) -> list[Any]: ...
    def cache_get(self, namespace: str, key: str) -> Any | None: ...
    def cache_set(self, namespace: str, key: str, value: Any) -> None: ...


@dataclass
class FlowContext:
    node_id: str
    chat_id: str | None
    run_id: str
    state: Any
    runtime: RuntimeApi
    services: Any


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
```

Notes:

- `services` is a dependency bag for adapters and nodes (tool registry, db hooks, broadcaster, etc.).
- Runtime never introspects returned artifact type from `materialize`.

## 5.2 TypeScript graph schema contracts (`nodes/_types.ts`)

Add optional channel metadata on sockets and persisted edges.

```ts
export type EdgeChannel = "flow" | "link";

export interface SocketConfig {
  type: SocketTypeId;
  side?: "left" | "right";
  bidirectional?: boolean;
  color?: string;
  shape?: SocketShape;
  channel?: EdgeChannel; // defaults to "flow"
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  data?: {
    sourceType?: string;
    targetType?: string;
    channel?: EdgeChannel;
  };
}
```

---

## 6) Runtime Behavior (Generic)

## 6.1 Flow execution

Runtime loop remains generic:

1. Identify executable nodes (`hasattr(executor, "execute")`).
2. Build active flow subgraph from edges where `channel == "flow"`.
3. Topologically sort.
4. For each node:
   - gather flow inputs from upstream outputs
   - resolve expressions generically
   - call executor
   - store outputs
   - emit events

No domain-specific edge filtering logic.

## 6.2 Link resolution

When a node needs dependencies:

- It calls `context.runtime.resolve_links(node_id, target_handle)`.
- Runtime finds incoming `link` edges for that handle.
- For each source edge:
  - load source executor
  - require `materialize`
  - call `materialize(source_data, source_handle, source_context)`
- cache and return artifact list.

No assumptions about tools/agents.

## 6.3 Caching and cycle handling

- Per-run cache key: `(run_id, node_id, output_handle, materialize_signature)`.
- Detect recursive link cycles with visiting stack keyed by `(node_id, output_handle)`.
- Raise clear cycle errors with node path.

---

## 7) Adapter Behavior (Chat)

`chat_graph_runner` is responsible for:

- converting chat messages to runtime state
- launching runtime execution
- mapping runtime/node events to `ChatEvent`
- persisting incremental/final content blocks
- integrating run-control (cancel/approval)
- creating/normalizing a canonical graph for non-`agent:<id>` chat configs so every chat path still goes through one graph runtime path

This keeps chat protocol concerns out of runtime core.

---

## 8) Phased Implementation Plan

Each phase has an objective, concrete file targets, and acceptance criteria.

## Phase 0 - Baseline and guardrails

Objective:

- Freeze behavioral baseline before refactor.

Changes:

- Add characterization tests for current chat events and branch commands.
- Capture current stream event sequences for:
  - simple chat
  - tool call
  - approval pause/resume
  - member run events

Files:

- `tests/test_flow_streaming.py`
- new `tests/test_chat_runtime_characterization.py`
- new `tests/test_branch_runtime_characterization.py`

Exit criteria:

- Characterization tests pass and are committed as migration safety net.

## Phase 1 - Introduce generic runtime contracts

Objective:

- Add capability contracts without changing behavior.
- Keep existing executor context fields (`agent`, `tool_registry`) only as a short-lived bridge until node self-resolution is complete.

Changes:

- Extend `FlowContext` with `runtime` and `services`.
- Add optional `materialize` protocol.
- Keep old fields temporarily for compatibility.

Files:

- `nodes/_types.py`
- test fixtures in `tests/conftest.py`
- executor unit tests using context constructors

Exit criteria:

- All tests compile with new context shape.

## Phase 2 - Edge channel metadata end-to-end

Objective:

- Make edge semantics explicit and generic.

Changes:

- Add `channel` metadata in TS edge model.
- In editor connect path, persist `edge.data.channel` from socket configs.
- Enforce strict graph normalization: reject missing/invalid channel metadata.
- Ensure edge `data` metadata survives API request/response and autosave serialization.

Files:

- `nodes/_types.ts`
- `app/lib/flow/context.tsx`
- `app/contexts/agent-editor-context.tsx`
- `backend/services/graph_normalizer.py` (new)
- `backend/services/agent_manager.py` (normalize at save/load boundaries)
- `backend/commands/agents.py` (GraphEdge schema includes edge `data` payload)

Exit criteria:

- New edges are persisted with channel metadata.
- Missing/invalid channel metadata is rejected at save/load/runtime boundaries.
- Edge channel metadata round-trips through save/load without loss.

## Phase 3 - Add `GraphRuntime` service

Objective:

- Centralize generic graph indexing, lookup, link resolution, and caches.

Changes:

- Add runtime service with:
  - node/edge indices
  - flow and link edge selectors
  - artifact cache
  - cycle guard
  - `resolve_links`

Files:

- `backend/services/graph_runtime.py` (new)
- `backend/services/flow_executor.py` (inject/use runtime)

Exit criteria:

- Flow execution still passes existing tests.
- Link resolver unit tests pass with custom fake nodes.

## Phase 4 - Migrate structural nodes to `materialize`

Objective:

- Remove dependence on BuildContext/StructuralResult path.

Changes:

- `toolset` executor implements `materialize` returning tool callables.
- `mcp-server` executor implements `materialize` returning tool callables.
- Keep `build()` temporarily as adapter/shim (deprecated).

Files:

- `nodes/tools/toolset/executor.py`
- `nodes/tools/mcp_server/executor.py`
- `tests/nodes/test_structural_executors.py` (convert to materialize-focused tests)

Exit criteria:

- link resolution via runtime returns expected artifacts.

## Phase 5 - Refactor agent node to fully self-resolve

Objective:

- Agent node builds/runs itself at execute time with no prebuilt root object.

Changes:

- Agent `execute()` resolves linked artifacts via `resolve_links(..., "tools")`.
- Agent `materialize()` returns runnable for composition use.
- Use runtime cache for repeated materialization.
- Remove dependency on `context.agent`.

Files:

- `nodes/core/agent/executor.py`
- `tests` covering:
  - sequential agents in flow
  - agent-as-link dependency
  - mixed dependency types

Exit criteria:

- multi-agent sequential and composed patterns both pass.

## Phase 6 - Unified chat adapter (`chat_graph_runner`)

Objective:

- Build one adapter to convert runtime events into chat protocol.

Changes:

- Move flow/content streaming glue into a single service.
- Keep frontend event contract stable (`RunContent`, `RunCompleted`, etc.).

Files:

- `backend/services/chat_graph_runner.py` (new)
- `backend/commands/streaming.py` (delegates)

Exit criteria:

- `stream_chat` and `stream_agent_chat` both run through `chat_graph_runner`.

Current progress note:

- `stream_chat`, `stream_agent_chat`, and `continue/retry/edit` paths now run through graph runtime without `has_flow_nodes` bifurcation.
- Non-agent chats use a canonical generated graph path (Chat Start -> Agent).
- `backend/services/chat_graph_runner.py` now owns graph resolution (`agent:<id>` vs canonical graph) and shared graph-runtime orchestration.
- Flow-to-chat event bridging (`handle_flow_stream`) now lives in `backend/services/chat_graph_runner.py`; commands call service adapters.
- `backend/services/run_control.py` now owns active-run, early-cancel, and tool-approval synchronization state.

## Phase 7 - Branch commands use same adapter

Objective:

- Eliminate branch command divergence.

Changes:

- Update `continue_message`, `retry_message`, `edit_user_message` to call `chat_graph_runner`.

Files:

- `backend/commands/branches.py`

Exit criteria:

- Branch actions use same graph runtime path as stream commands.

## Phase 8 - Extract run control service

Objective:

- Centralize cancellation and approval state.

Changes:

- Create `run_control.py` for active-run tracking, cancel signaling, approval synchronization.
- Commands become thin wrappers.

Files:

- `backend/services/run_control.py` (new)
- `backend/commands/streaming.py`

Exit criteria:

- Cancel/approval behavior parity across all actions.

Current progress note:

- Streaming command now delegates active-run + approval state to `run_control`.
- Added dedicated unit coverage for run-control state transitions and command integration.

## Phase 9 - Remove legacy architecture

Objective:

- Delete phase split and root-agent factories.

Changes:

- Remove `graph_executor.py` usage and delete file when safe.
- Remove `agent_factory.py` usage and delete file when safe.
- Remove `has_flow_nodes` bifurcation.
- Remove old BuildContext and structural result types.

Files:

- `backend/services/graph_executor.py` (delete)
- `backend/services/agent_factory.py` (delete)
- `backend/services/flow_executor.py`
- `nodes/_types.py`

Exit criteria:

- No call sites to deleted architecture remain.

## Phase 10 - Hardening and performance

Objective:

- Stabilize latency/memory and improve observability.

Changes:

- Add run-scoped metrics:
  - node execution latency
  - materialization cache hit rate
  - link resolution fanout depth
- Add debug dumps for normalized graph and channels.

Files:

- runtime + adapter logging paths
- tests for cache behavior

Exit criteria:

- performance and reliability within acceptable bounds.

---

## 9) What Must Be Removed From Runtime Core

These are explicit anti-goals and should be checked in review:

- No hardcoded domain handle lists (e.g. no special-casing `"tools"`).
- No hardcoded domain node checks (e.g. no checks for `"agent"`).
- No command-specific branching inside runtime kernel.
- No chat persistence logic in kernel.

Runtime should only process channels and capabilities.

---

## 10) Migration Direction (Strict Cutover)

## 10.1 Graph schema strategy

Graph contracts are strict:

1. `edge.data.channel` is required.
2. Invalid/missing channel fails fast.
3. Migration of old data is explicit (offline/scripted), not implicit at runtime.

## 10.2 Runtime path strategy

- Prefer direct cutover for command routing when parity is proven.
- Remove runtime branching (`has_flow_nodes`/legacy fallbacks) as each entrypoint migrates.

## 10.3 Normalizer scope

- Keep one normalization implementation shared at all save/load/execute boundaries.
- Normalizer validates and dedupes; it does not infer legacy semantics.

## 10.4 Non-agent chat migration

- For config-based chats (provider/model/tool IDs), generate a canonical runtime graph (e.g., Chat Start -> Agent) in adapter space.
- Run the canonical graph through the same runtime + adapter path as graph-backed agents.
- Keep persisted chat config as source of truth for defaults, but execute via graph runtime only.

---

## 11) Test Strategy

## 11.1 Runtime genericity tests (new)

Add tests with fake custom node types that runtime has never seen:

- custom link provider A -> custom consumer B (no tool/agent terms)
- mixed flow + link edges in one graph
- nested materialization graph
- link cycle detection

These tests ensure runtime architecture is truly generic.

## 11.2 Adapter parity tests

Ensure chat adapter parity with characterization baseline:

- token streaming sequence
- reasoning events
- tool approval lifecycle
- run cancellation
- branch command behavior

## 11.3 Regression tests to retire/replace

- Replace tests focused on `build_agent_from_graph` with runtime + node capability tests.

---

## 12) Risks and Mitigations

1. Risk: event parity regression in UI.
   - Mitigation: lock event characterization tests before migration.
2. Risk: materialization loops.
   - Mitigation: explicit cycle detection with path diagnostics.
3. Risk: runtime latency from repeated materialization.
   - Mitigation: per-run artifact cache.
4. Risk: legacy graph channel ambiguity.
   - Mitigation: strict validation + explicit migration tooling.
5. Risk: hidden command divergence remains.
   - Mitigation: enforce all command entrypoints use one adapter service.

---

## 13) Delivery Plan (Suggested PR Breakdown)

PR 1:

- Phase 0 + Phase 1 scaffolding (contracts, fixture updates, characterization tests)

PR 2:

- Phase 2 channel metadata + graph normalizer

PR 3:

- Phase 3 GraphRuntime + flow executor integration (no behavior change)

PR 4:

- Phase 4 structural node materialize migration

PR 5:

- Phase 5 agent node self-resolution

PR 6:

- Phase 6 chat_graph_runner + streaming command integration

PR 7:

- Phase 7 branch commands integration

PR 8:

- Phase 8 run_control extraction

PR 9:

- Phase 9 legacy deletion + cleanup

PR 10:

- Phase 10 hardening, observability, and docs finalization

---

## 14) Definition of Done

All of the following must be true:

1. Runtime core contains no agent/tool-specific branching.
2. All chat command paths use one adapter + one runtime.
3. Agent node resolves/materializes itself at execution time.
4. Runtime and persistence reject invalid graph metadata (fail fast, no implicit legacy fallback).
5. UI event behavior remains stable.
6. Test suite includes generic custom-node coverage proving extensibility.

---

## 15) Appendix: Example Node Patterns

## 15.1 Pure flow node

- Implements only `execute`.
- Uses flow inputs and outputs only.

## 15.2 Pure link/materializer node

- Implements only `materialize`.
- Produces artifacts for dependency consumers.

## 15.3 Hybrid node

- Implements both.
- Can be used as a dependency artifact and as a runnable flow stage.

This pattern generalizes naturally for future node classes (memory, retrievers, policies, connectors, evaluators) without changing runtime core.
