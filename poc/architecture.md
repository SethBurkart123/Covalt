# Architecture

How the node graph works. The design, the decisions, the system.

## The Hybrid

Two connection systems on one canvas, inspired by two different worlds:

**The data spine (n8n-style).** A generic data wire connects nodes in sequence. Every flow node has a data input and a data output. The wire carries JSON — whatever the node produced. Any parameter on any downstream node can reach into any upstream node's output using expressions. The wire means "this runs after that, and the data is available."

**Typed side sockets (Blender-style).** Colored, type-safe connections for specific things: tools, models, agent composition. A model node wires into an agent's model socket. A toolset wires into an agent's tools socket. These have their own type system, their own coercion rules, their own visual language.

Users don't think about the distinction. They wire things together. The system figures out what's data flow and what's structural.

## One Canvas, Two Roles

The graph editor serves two purposes on a single canvas:

**Structural composition** describes what an agent *is*. An Agent node with MCP servers, toolsets, and sub-agents wired to its tools socket. That cluster compiles into a single Agno Agent or Team. This only happens via the typed side sockets — an agent and whatever hangs off its tools socket.

**Flow** describes what *happens*. Data enters via Chat Start, moves through nodes, gets processed, produces output. The data spine carries it. The graph executes once per user message, top to bottom.

## The Graph Processes One Turn

A graph defines how a single conversation turn is handled. User sends a message, the graph executes, a response comes back.

Conversation history lives inside the Agent node, managed by Agno's session system. The graph doesn't carry message history through wires — it carries the current turn's content.

This means:
- Chat Start outputs the current user message as data
- Agent nodes manage their own history internally
- The graph is stateless across turns
- Memory customization (if needed later) is a node that plugs into an agent structurally, not a data pipe

## The Data Spine

### How Data Flows

Every flow node has a data input (left) and data output (right). The data is always JSON — an object with whatever fields the node produces.

```
Chat Start ──data──> Agent ──data──> LLM Completion ──data──> ...
```

Chat Start outputs: `{ message: "What's the weather?" }`
Agent outputs: `{ response: "The weather is sunny.", model: "anthropic:claude-sonnet-4-20250514", tokens_used: { prompt: 42, completion: 12 } }`
LLM Completion outputs: `{ text: "...", usage: { ... } }`

Each node's output is available to all downstream nodes via expressions. Not just the directly connected node — any node upstream in the execution path.

### Expressions

The expression system lets any parameter reference any upstream node's output:

```
{{ $('Chat Start').item.json.message }}
{{ $('HTTP Request').item.json.response.status }}
{{ $('Agent').item.json.response }}
```

Syntax: `{{ $('Node Name').item.json.fieldPath }}`

- `$('Node Name')` — references a specific upstream node by its display name
- `.item.json` — accesses the node's output data
- `.fieldPath` — dot-notation path into the JSON object

Only upstream nodes (topological predecessors) are accessible. Referencing a node that hasn't executed yet is an error.

**Priority: Wire > Expression > Inline value.** A typed side wire always wins. An expression overrides an inline value. If nothing is wired and no expression is present, the inline value is used.

### What the Engine Does

The flow engine doesn't need to know about types for the data spine. It:

1. Topologically sorts flow nodes
2. Executes each node, stores its output as a JSON blob
3. Makes all upstream outputs available via the expression resolver
4. Feeds the direct parent's output as the node's default data input
5. Skips nodes whose required inputs aren't satisfied (dead branches)

No coercion. No type checking. It's all JSON.

## Typed Side Sockets

### The Type Set

Side sockets use a typed, colored system. Each type is visually distinct.

**Structural types — topology, not data:**

| Type | Color | Shape | Purpose |
|------|-------|-------|---------|
| `agent` | Purple `#7c3aed` | Circle | Agent composition. Sub-agent wiring. |
| `tools` | Amber `#f59e0b` | Square | Tool attachment. MCP servers, toolsets wire into an agent. |

**Configuration types — for hybrid parameters:**

| Type | Color | Shape | Purpose |
|------|-------|-------|---------|
| `model` | Cyan `#06b6d4` | Circle | Provider + model reference. Fan out one model to many nodes. |
| `string` | Blue `#3b82f6` | Circle | Text values. Instructions, labels. |
| `float` | Gray `#a1a1aa` | Circle | Decimal numbers. Temperature, thresholds. |
| `int` | Dark gray `#71717a` | Circle | Integers. Token limits, counts. |
| `boolean` | Green `#10b981` | Diamond | Toggles. |
| `json` | Orange `#f97316` | Circle | Structured config objects. |
| `messages` | Violet `#a855f7` | Circle | `[{role, content}]` arrays. For when you genuinely need message format. |

### Coercion (Side Sockets Only)

The coercion table applies exclusively to typed side socket connections. Not to the data spine.

| From | To | How |
|------|----|-----|
| `int` | `float` | Lossless promotion |
| `int` / `float` / `boolean` | `string` | toString |
| `json` | `string` | JSON.stringify |
| `string` | `messages` | Wrap as `[{role: "user", content: text}]` |
| `messages` | `string` | Extract last message content |
| `agent` | `tools` | Agent becomes a callable tool (structural) |

Anything not in this table doesn't auto-connect. The editor blocks it. If someone needs an exotic conversion, they use a transform node or configure it with an expression.

### Hybrid Parameters

Borrowed from Blender. A hybrid parameter shows an inline control by default but has a typed socket. When a wire connects, the wire value takes over and the inline control dims.

This is how nodes stay clean. An Agent node shows a model dropdown, an instructions text area, a temperature slider — no visible sockets cluttering the UI. But each has a small socket point that lights up when you drag a compatible wire near it.

The socket is always there. The control is the default experience. Power users wire things up. Everyone else just fills in fields.

## How Nodes Look

An Agent node in practice:

```
+-----------------------------------------+
|  Agent                                  |
+-----------------------------------------+
|                                         |
|  > Data                      Tools []=  |  data in (generic), structural tools
|                            Output >     |  data out (generic)
|                                         |
|  * Model       [Claude 4 Sonnet  v]    |  hybrid: dropdown or typed wire
|  * Instructions                         |  hybrid: text area or typed wire
|    [You are a helpful assistant...]     |
|  * Temperature [----o-----------]       |  hybrid: slider or typed wire
|                                         |
+-----------------------------------------+
```

`>` markers are the generic data spine connections. `*` dots are typed side sockets. `[]=` is the structural tools socket.

Most users interact with the inline controls and never think about the sockets. Advanced users wire Model nodes, expression-driven instructions, and dynamic temperatures.

## Structural Clusters

When an Agent node has things connected to its tools socket — MCP servers, toolsets, other agents — that cluster compiles into a single Agno Agent or Team before flow execution begins.

```
                     Agent
                       | tools
                 +-----+------+
                 |            |
              MCP Server   Sub-Agent
                              | tools
                           Toolset
```

This whole tree is structural. It compiles once, produces an Agent/Team object, and that object is what the Agent node uses during flow execution.

A sub-agent (an Agent node wired to another Agent's tools socket) is structural — it and its own tools tree compile into a tool the parent agent can call. From the flow's perspective, the parent Agent is one node. The sub-agent tree is invisible.

## Two-Phase Execution

**Phase 1 — Build (Structural).** Walk the structural subgraph (edges with `agent` or `tools` socket types). Compile each structural cluster into Agno Agent/Team objects via executor `build()` methods. Recursive — sub-agents build their own tool trees first.

**Phase 2 — Run (Flow).** If the graph has flow-capable nodes (executors with `execute()` methods), run them in topological order. Each node receives data from upstream, processes it, produces output. The data spine carries JSON between nodes. Typed side sockets were already resolved in Phase 1 or carry their values directly.

If the graph has no flow nodes — just a structural agent cluster — Phase 2 is skipped. The agent runs directly via Agno's streaming, exactly like a simple chat.

## The Node Plugin System

### Every Node is a Folder

```
nodes/
  _types.ts              # Shared TS types (SocketTypeId, Parameter, NodeDefinition)
  _types.py              # Shared Python types (DataValue, NodeEvent, ExecutionResult)
  _registry.ts           # TS node registry (explicit imports)
  _registry.py           # Python auto-discovery engine
  _coerce.py             # Runtime type coercion (side sockets)
  _expressions.py        # Expression evaluator

  core/
    chat_start/
      definition.ts      # What the node looks like
      executor.py         # What the node does

    agent/
      definition.ts
      executor.py

  tools/
    mcp_server/
      definition.ts
      executor.py

    toolset/
      definition.ts
      executor.py

  ai/
    llm_completion/
      definition.ts
      executor.py

  flow/
    conditional/
      definition.ts
      executor.py

  utility/
    model_selector/
      definition.ts
      executor.py
```

Each node lives in a folder with two files. The `definition.ts` describes the node (parameters, sockets, icon, category). The `executor.py` implements it (structural build, flow execution, or both).

### Discovery

**Python: convention-based auto-discovery.** `_registry.py` scans `nodes/**/executor.py` at import time, imports each, registers by `node_type`. Drop a folder with an `executor.py`, restart, it appears. No central list.

**TypeScript: explicit imports.** `_registry.ts` imports all definitions and exposes lookup functions. Adding a node means adding one import line. Auto-discovery in TS/Next.js adds build complexity without proportional benefit.

### The Executor Contract

Every `executor.py` exports an `executor` object. Two optional methods:

```python
class StructuralExecutor(Protocol):
    node_type: str
    def build(self, data: dict, context: BuildContext) -> StructuralResult: ...

class FlowExecutor(Protocol):
    node_type: str
    async def execute(self, data: dict, inputs: dict[str, DataValue], context: FlowContext)
        -> ExecutionResult | AsyncIterator[NodeEvent | ExecutionResult]: ...
```

- **Structural-only** nodes implement `build()`. MCP Server, Toolset.
- **Flow-only** nodes implement `execute()`. LLM Completion, Conditional.
- **Hybrid** nodes implement both. Agent, Chat Start.

The registry detects which methods a node implements. The engine delegates accordingly.

### ExecutionResult

```python
@dataclass
class ExecutionResult:
    outputs: dict[str, DataValue]    # Values on output ports
    events: list[NodeEvent]          # Events emitted during execution
```

For **streaming nodes** (LLM, Agent), `execute()` is an async generator yielding `NodeEvent`s during work, with a final `ExecutionResult`. For **synchronous nodes** (transforms, conditionals), `execute()` returns an `ExecutionResult` directly. Same signature, same return type. The engine handles both.

### Flow Control is Just Data Routing

Flow control nodes aren't special. They follow the same rule — inputs in, execute, outputs out.

A Conditional node evaluates a condition and puts data on the `true` or `false` output port. The other port stays empty. The engine follows edges from ports that have values. Empty ports = branches that don't execute.

No skip tokens. No special engine support. The engine already only follows edges from populated output ports. Branching emerges from the data, not from special logic.

### The Event Protocol

Every node emits `NodeEvent` objects during execution:

```python
@dataclass
class NodeEvent:
    node_id: str
    node_type: str
    event_type: str       # started | progress | completed | error | agent_event
    run_id: str
    data: dict | None
    timestamp: float
```

Events power the chat UI (streaming tokens, showing progress), the flow canvas (animating node borders during execution), and debugging (full event logs).

The streaming layer translates `NodeEvent` types into `ChatEvent` WebSocket messages:
- `started` -> `FlowNodeStarted`
- `progress` (tokens) -> `RunContent`
- `completed` -> `FlowNodeCompleted`
- `error` -> `RunError`

Agent nodes in flow mode emit their Agno events wrapped as `agent_event` — full compatibility with the existing chat rendering.

## Node Catalog

### Currently Implemented

| Node | Category | Mode | Purpose |
|------|----------|------|---------|
| **Chat Start** | core | hybrid | Bridge between chat interface and graph. Outputs user message as data. |
| **Agent** | core | hybrid | Builds Agno Agent/Team (structural). Runs agent with input (flow). |
| **MCP Server** | tools | structural | Resolves tools from an MCP server. |
| **Toolset** | tools | structural | Resolves tools from a registered toolset. |
| **LLM Completion** | ai | flow | Single LLM call. Prompt in, text out. Streams tokens. |
| **Conditional** | flow | flow | If/else routing based on field evaluation. |
| **Model Selector** | utility | flow | Passes a model reference through. Fan out to multiple nodes. |

### Planned

| Node | Category | Mode | Purpose |
|------|----------|------|---------|
| **Structured Output** | ai | flow | LLM call with JSON schema enforcement. |
| **Classifier / Router** | ai | flow | Classify input, route to N output branches. |
| **HTTP Request** | integration | flow | External API calls. |
| **JSON Transform** | data | flow | Reshape JSON with expressions. |
| **Code** | flow | flow | Run Python code for custom transforms. |
| **Merge** | flow | flow | Wait for and combine multiple branch inputs. |
| **Loop** | flow | flow | Container loop with internal sub-graph. |

## What Needs to Change

### Expression System Upgrade

**Current:** `{{ input.fieldName }}` — only references the direct data input on the current node.

**Target:** `{{ $('Node Name').item.json.fieldName }}` — references any upstream node's output by name.

This requires:
- The flow engine to maintain a map of `node_name -> output_data` as it executes
- The expression resolver to parse the `$('Name')` syntax and look up outputs
- Keep backward compat for `{{ input.x }}` as shorthand for the direct parent's output

### Data Spine Wiring

**Current:** The main flow uses typed sockets (`string`, `json`, `messages`) for data I/O.

**Target:** One generic data type for the main flow. Every flow node has a `data` input and `data` output carrying untyped JSON.

This requires:
- A new `data` socket type (or repurposing `json`) for the main spine
- Updating node definitions to use generic data I/O instead of typed flow sockets
- The flow engine to pass JSON blobs between nodes without type checking
- The expression system to be the primary way nodes access specific fields from upstream data

### Node Output Shapes

Each node needs a defined output schema — what fields appear in its data output:
- Chat Start: `{ message: string }`
- Agent: `{ response: string, model: string, tokens_used: object }`
- LLM Completion: `{ text: string, usage: object }`
- Conditional: passes through input data on the active branch

## What This Gets Right

- **Clean nodes.** Inline controls by default, typed sockets only for structural/config connections.
- **One data pipe.** The generic data spine carries the payload. Expressions dig into it. No type gymnastics for basic data access.
- **Typed where it matters.** Blender-style colored sockets for structural composition and configuration. Coercion for common conversions between those types.
- **n8n familiarity.** The data model and expression syntax are immediately recognizable to anyone who's used n8n.
- **Structural is scoped.** Only agent + tools clusters. Everything else is flow. Users don't think about the distinction.
- **Per-turn execution.** The graph handles one message. History is the agent's problem.
- **Drop-in nodes.** Add a folder, restart, it works.
