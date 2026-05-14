# Node System v2

This document describes the architecture for a general-purpose visual node system. The design prioritizes composability, extensibility, and minimal core concepts. Rather than building special cases for tools, loops, or foreign integrations, the system provides five primitives from which all patterns emerge naturally.

## Design Philosophy

The system is built on a simple observation: most node-based tools grow organically around specific use cases, adding special cases until the architecture becomes a maze of exceptions. This specification inverts that approach.

We identify the smallest set of primitives that, when composed, can express any node behavior. Tools, loops, parallel execution, foreign system integration, runtime observation, and approval gates all become ordinary applications of the same core concepts.

### Guiding Principles

**Nodes are processes, not functions.** A node has lifecycle, state, and bidirectional communication. It emits events over time and can receive events while running. This accommodates everything from instant transforms to long-running agents.

**Connections have explicit semantics.** A connection doesn't just "pass data" — it specifies whether you receive a value, a callable handle, or full structural access. This eliminates ambiguity about who controls execution.

**Types are namespaced and schema-defined.** Connection compatibility is checked against schemas, not magic strings. Custom types use namespaces to prevent collisions.

**Regions are first-class.** A bounded subgraph with entry and exit points can be invoked as a unit. This enables loops, parallel execution, and visual grouping without special-casing any of them.

**The runtime is observable and controllable.** Nodes can inspect running processes, subscribe to events, and intervene. Supervision and debugging are built on the same primitives as execution.

**No magic, only composition.** Every pattern — tools, triggers, variables, foreign systems — emerges from combining the primitives. If you understand the five concepts, you understand the whole system.

## The Five Primitives

### 1. Event Processes

A node is a stateful process that runs over time. During execution it may emit progress events, request approvals, stream partial results, or report state changes. It can also receive events from outside — stop signals, pause requests, or injected data from supervisors.

Most nodes are **triggered** — they run when their inputs are ready. Some nodes are **ambient** — they start when the workflow starts and run continuously alongside normal execution. Observers, supervisors, and queue processors are typically ambient.

When a node emits outputs, it controls what happens next: continue running (fire and forget), wait for downstream to complete (gated processing), or terminate. This is purely imperative — the node decides based on its current situation.

Events are the universal communication mechanism. Everything that happens during execution is expressed as an event, and any node can subscribe to events from other nodes.

[Read more about Event Processes →](./events.md)

### 2. Ports and Schemas

Ports are typed connection points. Each port has a direction (in/out), a mode, and a schema.

The mode determines what flows through the connection:
- **Value** — Data flows when the source completes. The runtime controls execution order.
- **Reference** — A callable handle. The target decides when to invoke.
- **Structural** — Full access to a region: definition, configuration, and invoke capability.

Schemas define data shapes using a JSON-Schema-like structure with namespaced custom types.

[Read more about Ports and Schemas →](./ports-and-schemas.md)

### 3. Regions

A region is a bounded subgraph with explicit entry and exit points. Entry defines what goes in, Exit defines what comes out plus a handle to the whole region.

Regions can be displayed as collapsed subgraphs (double-click to edit) or inline closure zones (visible in the parent graph). The same region can be invoked from multiple places.

Foreign subgraphs contain nodes from external systems (ComfyUI, n8n) with their own rendering and execution, bridged to our event model.

[Read more about Regions →](./regions.md)

### 4. Runtime

The runtime is the execution environment. It schedules nodes, routes events, and provides observation and control capabilities.

Nodes interact with the runtime to execute regions, subscribe to events, inspect running processes, and invoke methods on other nodes. When emitting outputs, nodes can choose to continue running, wait for downstream completion (receiving their results), or terminate.

[Read more about Runtime →](./runtime.md)

### 5. Controls and Methods

Controls are UI elements for node configuration. They can have static or dynamic options, with dynamic options loaded by calling methods on the node.

Nodes can expose methods that other nodes (or external APIs) can call. This enables patterns like forwarding control definitions to trigger nodes without duplicating code.

[Read more about Controls and Methods →](./controls.md)

## How Patterns Emerge

The primitives compose to express complex behaviors:

| Pattern | Primitives Used |
|---------|-----------------|
| Data transforms | Value-mode ports |
| Tool consumption | Reference-mode ports |
| Loop/parallel execution | Structural-mode ports, regions |
| Foreign systems (ComfyUI) | Foreign subgraphs, bridges |
| Runtime supervision | Event subscription, runtime control |
| Approval gates | Event subscription, persistence |
| Configurable triggers | Controls, methods, forwarded definitions |

See [Examples](./examples.md) for detailed implementations of each pattern.

## Document Index

- [Ports and Schemas](./ports-and-schemas.md) — Connection modes, type system, compatibility rules
- [Regions](./regions.md) — Entry/Exit, subgraphs, closures, foreign bridges
- [Events](./events.md) — Event processes, lifecycle, filtering, subscriptions
- [Runtime](./runtime.md) — Execution, observation, control, methods
- [Controls](./controls.md) — Configuration UI, dynamic options, variable forwarding
- [Examples](./examples.md) — Complete implementations of common patterns
