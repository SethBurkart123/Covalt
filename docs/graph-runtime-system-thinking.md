# Graph Runtime System Thinking

Status: design doc

Last updated: 2026-02-13

---

## Purpose

Capture the way of thinking behind the runtime system we are building, and the
approach we use to implement it. This is not a list of tasks. It is a set of
principles, contracts, and boundaries that keep the system generic, extensible,
and correct as it grows.

This doc focuses on the conceptual system and how we approach implementation.
For the concrete execution plan and milestones, see:

- `docs/graph-runtime-unification-plan.md`

---

## Core Idea

We are building a single graph runtime kernel that can execute any custom node
without hardcoded knowledge of domain concepts (agents, tools, chat-start, etc).

The runtime only understands graph primitives:

- nodes
- handles/ports
- edges
- channels
- scheduling and value routing

Everything else lives in nodes and adapters.

If a behavior is domain specific, it belongs in the node executor or a service
layer, never in the runtime kernel.

---

## Mental Model

Every graph has two independent kinds of relationships between nodes:

1. Flow edges
   - Data moves along these edges during execution.
   - Example: output of a prompt template flows into a completion node.

2. Link edges
   - Dependencies are wired along these edges.
   - Example: an agent node links to tool nodes, or a node links to a resolver.

The runtime does not interpret what a link means. It only provides a generic
API to resolve link artifacts when a node asks for them.

---

## System Principles

### 1) One runtime path, always

All chat entrypoints run through the same graph executor path. No special-case
"simple" runtime or prebuild phases. If it is a chat run, it is a graph run.

### 2) Runtime is domain-agnostic

The kernel must not branch on node types or handle names. No `if node == agent`.
No `if handle == tools`. The runtime only knows about channels, edges, and
execution ordering.

### 3) Nodes own their meaning

Each node is responsible for its own semantics. If a node needs a toolset, a
database, or a model, the node requests it from the runtime or services and
interprets it itself. The runtime does not decide how a node should behave.

### 4) Declarative wiring, not implicit behavior

Edges carry explicit channel metadata. The runtime uses that channel data to
route values or resolve dependencies. No hidden inference based on node type or
handle name.

### 5) Composition and pipelines are first-class and distinct

- Pipeline: flow edge between nodes means sequential execution.
- Composition: link edge into a node means dependency assembly.

These two modes must coexist in one graph without any special cases.

---

## Graph and Runtime Abstractions

### Graph primitives

- Node: typed node with `type`, `id`, and `data`.
- Handle: named port with a type and a mode.
- Edge: connection between handles, with an explicit `channel`.
- Channel: `flow` for data routing, `link` for dependency wiring.

### DataValue

Flow edges carry a `DataValue` object (type + value). Coercions are explicit
and enforced. If conversion is allowed, runtime performs it; otherwise it
fails fast.

### ExecutionResult and NodeEvent

Nodes can return:

- `ExecutionResult` with typed outputs
- Stream of `NodeEvent` plus a final `ExecutionResult`

Runtime treats these generically and does not interpret the events.

---

## Node Capabilities

Nodes declare capabilities through the functions they implement:

1) `execute(...)`
   - For flow behavior
   - Consumes routed inputs
   - Emits outputs as `DataValue` instances

2) `materialize(...)`
   - For link outputs
   - Returns an opaque artifact
   - Runtime does not interpret it

Nodes can be:

- Flow-only (execute only)
- Link-only (materialize only)
- Hybrid (both)

The runtime does not care which kind it is. It simply calls the supported
capability when needed.

---

## Runtime Responsibilities

The runtime kernel is responsible for:

- Topological scheduling of flow nodes
- Gathering inputs from upstream flow edges
- Type coercion and expression evaluation
- Detecting and surfacing graph errors (cycles, missing nodes)
- Invoking node executors
- Providing generic APIs for resolving link outputs
- Caching materialized artifacts for the duration of a run

The runtime is not responsible for:

- Building agents or tools
- Interpreting link artifacts
- Chat history or messaging semantics
- Streaming protocol details

---

## Runtime API (generic only)

Nodes can call runtime functions to navigate the graph without the runtime
understanding why:

- `incoming_edges(node_id, channel, target_handle)`
- `outgoing_edges(node_id, channel, source_handle)`
- `resolve_links(node_id, target_handle)`
- `materialize_output(node_id, output_handle)`
- `cache_get` and `cache_set`

This keeps the runtime generic and prevents domain-specific helpers from
leaking into it.

---

## Services and Adapters

`FlowContext.services` is an injected, runtime-agnostic bag for domain concerns.
Examples:

- chat scope policy (entry vs downstream nodes)
- tool registry
- run control and approvals
- event broadcasters

These services are not runtime behavior. They are implementation details of a
specific execution environment (chat, tests, etc).

---

## Example: Agent Node Without Runtime Special-Casing

The runtime does not know what an agent is. The agent node does:

1. `execute()` resolves its model and instructions from inputs and node data
2. It calls `runtime.resolve_links(self_id, "tools")`
3. It materializes linked tool nodes by calling their `materialize()`
4. It builds a runnable agent/team object
5. It runs and streams events, returning outputs as `DataValue`

The runtime never branches on `agent` or `tools`. The agent node does all the
work it needs using generic runtime functions.

---

## Implementation Approach

When we implement this system, we follow a consistent sequence:

1) Define the contract
   - Decide the runtime API and node capability shape
   - Ensure everything is domain-agnostic

2) Make edges explicit
   - Introduce `data.channel` and enforce it everywhere
   - Keep legacy normalization only as a temporary migration aid

3) Move behavior into nodes
   - Any special logic in the runtime gets moved into executors
   - Runtime becomes a graph scheduler and router only

4) Unify execution paths
   - Chat, test chat, retry, continue, edit all call the same graph runner
   - No alternate content stream path

5) Delete prebuild phases
   - Remove root prebuild functions and graph-specific agent factories
   - Nodes materialize what they need, when they need it

6) Lock it with tests
   - Create generic node tests (not agent-only tests)
   - Prove the kernel works with arbitrary custom nodes

---

## Design Guardrails

These are non-negotiable rules that prevent architectural drift:

- The runtime kernel never checks node types or handle names
- The runtime kernel never constructs domain objects (agents, tools)
- Edges always carry explicit `flow` or `link` channel metadata
- The only authority for domain behavior is the node executor
- All chat entrypoints share one execution path

If a change violates these, it is not aligned with this system.

---

## Testing Strategy

We test the system as a generic runtime, not an agent runtime:

1. Use fake custom nodes with non-agent handles to prove generic routing
2. Validate both flow execution and link materialization in the same graph
3. Prove that disconnected subgraphs do not execute
4. Ensure link cycles are detected and reported cleanly
5. Verify that node lifecycle events are emitted consistently

Agent-specific tests exist, but only to confirm that agent nodes can be built
within the generic runtime, not to validate runtime behavior itself.

---

## Migration Philosophy

We keep compatibility only as long as needed to transition:

- Temporary graph normalization for missing channel data
- Adapter layers to keep frontend event protocol stable
- Small wrappers around legacy nodes during migration

Once parity is confirmed, we remove the compatibility layers. The goal is a
simple and coherent runtime, not long-term compatibility baggage.

---

## The End State

When this system is fully implemented, we will have:

- One runtime kernel with no domain knowledge
- Nodes that define their own semantics via execute/materialize
- Edge channels as the single source of truth for flow vs link
- A single chat execution path with consistent behavior
- A clean, testable architecture that enables new node types without touching
  the runtime core

That is the system we are building.
