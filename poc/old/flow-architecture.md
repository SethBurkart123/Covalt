# Flow Architecture

How the node graph works. Not implementation — behavior and feel.

## One Canvas, Two Roles

The graph editor serves two purposes on a single canvas:

**Structural composition** describes what an agent *is*. An Agent node with MCP servers, toolsets, and sub-agents wired to its tools socket. That cluster of nodes compiles into a single Agno Agent or Team. It acts as one unit. This is the only time structural composition happens — an agent and whatever hangs off its tools socket.

**Flow** describes what *happens*. Data enters, gets processed, moves through nodes, produces output. The root agent is a flow node. LLM completions, conditionals, HTTP requests, transforms — all flow. The graph executes once per user message, top to bottom.

Users don't think about modes. They wire things together. The system figures out which parts are structural (agent + tools clusters) and which are flow (everything else).

## The Graph Processes One Turn

A graph defines how a single conversation turn is handled. User sends a message, the graph executes, a response comes back.

Conversation history is not graph data. It lives inside the Agent node, managed by Agno's session system. The graph doesn't carry message history through wires — it carries the current turn's content.

This means:
- Chat Start outputs the current user message
- Agent nodes manage their own history internally
- The graph is stateless across turns
- Memory customization (if needed later) is a node that plugs into an agent structurally, not a data pipe

## Types

### The Type Set

Nine types. Each visually distinct, each earns its place.

**Flow types — data that moves through the graph:**

| Type | Purpose |
|------|---------|
| `string` | Text. The universal flow type. Messages, prompts, responses, labels. |
| `float` | Decimal numbers. Temperature, scores, thresholds. |
| `int` | Integers. Counts, limits, indices. |
| `boolean` | True/false. Conditions, toggles. |
| `json` | Structured objects. API responses, configs, complex data. |
| `messages` | `[{role, content}]` arrays. Conversation context when you genuinely need it. |
| `model` | Provider + model reference. Fan out one model selection to many nodes. |

**Structural types — topology, not data:**

| Type | Purpose |
|------|---------|
| `agent` | Agent composition. Connects an agent's output to another agent's tools (becomes a sub-agent). |
| `tools` | Tool attachment. MCP servers, toolsets, sub-agents wire into an agent's tools socket. |

### Coercion

Common conversions happen automatically. The wire connects, the runtime handles it.

| From | To | How |
|------|----|-----|
| `string` | `messages` | Wrap as `[{role: "user", content: text}]` |
| `messages` | `string` | Extract last message content |
| `int` | `float` | Lossless promotion |
| `int` / `float` / `boolean` | `string` | toString |
| `json` | `string` | JSON.stringify |
| `agent` | `tools` | Agent becomes a callable tool (structural, existing behavior) |

Anything not in this table doesn't auto-connect. If someone needs an exotic conversion, they use a transform node or configure it with an expression.

## Three Layers of Data Entry

Every parameter on every node can receive its value three ways:

**1. Inline value** — The user types or selects directly in the control. A dropdown for model, a slider for temperature, a text field for instructions. This is the default experience.

**2. Expression** — Any text-like field can reference data from the node's general input using `{{input.fieldName}}`. Pulls values at runtime from whatever arrived on the data pipe.

**3. Typed wire** — A direct socket connection from another node. A Model node wired to the model socket. A float output wired to the temperature socket.

**Priority: Wire > Expression > Inline value.** A wire always wins. An expression overrides an inline value. If nothing is wired and no expression is present, the inline value is used.

## The General Input

Every flow node has a general input socket on its left side. This is the data pipe — it carries structured data (JSON) from whatever node is upstream.

The general input serves two purposes:

1. **It's the main data payload.** For an Agent node, it's "what to respond to." For an LLM Completion, it's the prompt. For a Conditional, it's the value to evaluate.

2. **It's accessible via expressions.** Any parameter in the node can reference fields from the general input using `{{input.fieldName}}`. This lets nodes consume rich upstream data without needing a dedicated socket for every possible field.

The general input accepts different types and coerces where possible:

| Incoming type | What the node does |
|--------------|-------------------|
| Native type (matches what the node expects) | Uses it directly |
| Coercible type (in the coercion table) | Converts automatically |
| Other JSON | Available via expressions in any field, but the node's primary function may need the user to configure which field to use |

For example, an Agent node expects `messages` or `string` on its general input. If it receives a `json` blob from an HTTP Request, the data is available — the user can write `{{input.response.answer}}` in a field — but the agent won't automatically know what to respond to unless the user tells it.

## Hybrid Parameters

Borrowed from Blender. A hybrid parameter shows an inline control by default but has a socket. When a wire connects, the wire value takes over and the inline control hides or dims.

This is how nodes stay clean. An Agent node shows a model dropdown, an instructions text area, a temperature slider — no visible sockets cluttering the UI. But each of those has a small socket point that lights up when you drag a compatible wire near it.

Hybrid parameters are the answer to "how do I make things connectable without covering every node in sockets." The socket is always there. The control is the default experience. Power users wire things up. Everyone else just fills in fields.

## How Nodes Look

An Agent node in practice:

```
+-----------------------------------------+
|  Agent                                  |
+-----------------------------------------+
|                                         |
|  * Data                      Tools []=  |  general input, structural tools
|                           Response *    |  flow output
|                                         |
|  * Model       [Claude 4 Sonnet  v]    |  hybrid: dropdown or wire
|  * Instructions                         |  hybrid: text area or wire
|    [You are a helpful assistant...]     |
|  * Temperature [----o-----------]       |  hybrid: slider or wire
|                                         |
+-----------------------------------------+
```

Small socket dots on the left of hybrid parameters. Unobtrusive. The general `Data` input and `Response` output are the flow connection points. `Tools` is structural. Everything else is configured inline unless wired.

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

A sub-agent (an Agent node wired to another Agent's tools socket) is structural — it and its own tools tree compile into a tool that the parent agent can call. From the flow's perspective, the parent Agent is one node. The sub-agent tree is invisible.

## What Flows Where

The simplest graph:

```
Chat Start --[string]--> Agent --[string]--> (response to chat)
```

Chat Start emits the user's message. Agent receives it, runs its agentic loop (with whatever tools are structurally attached), produces a response. The response goes back to the chat UI.

A pipeline:

```
Chat Start --[string]--> Prompt Template --[string]--> LLM Completion --[string]--> Agent
```

The user's message gets templated, run through a raw LLM call, then the result feeds into an Agent. Each node processes and passes along.

A branching flow:

```
Chat Start --> Classifier --> [branch A] --> Agent A
                          --> [branch B] --> Agent B
```

Classifier routes based on content. One branch executes. The other is naturally dead (no data on that path, downstream nodes don't fire).

## What This Gets Right

- **Clean nodes.** Inline controls by default, sockets when you need them.
- **One data pipe.** The general input carries the payload. Expressions dig into it. No merge nodes for basic data access.
- **Typed but flexible.** Blender-style colored sockets for visual safety. Coercion for common conversions. Not rigid.
- **Structural is scoped.** Only agent + tools clusters. Everything else is flow. Users don't think about the distinction.
- **Per-turn execution.** The graph handles one message. History is the agent's problem. No "messages flowing bidirectionally" confusion.
