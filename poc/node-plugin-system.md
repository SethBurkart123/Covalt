# Node Plugin System

A unified, extensible architecture for defining, discovering, and executing graph nodes — where adding a node is as simple as dropping a folder.

## The Core Insight

Right now, adding a node touches three separate places across two languages with no auto-discovery. The backend executor is a hardcoded if/elif chain. And the system only supports structural composition — it can't run data through a pipeline.

The providers system shows how it should work: drop a file, it appears. No registration, no central lists, no dispatch tables. We bring that same philosophy to nodes, but with a twist — nodes live in both languages, so each node is a **folder** containing both its frontend definition and its backend executor.

## Two Modes, One Graph

The graph editor supports two fundamentally different kinds of work:

**Structural composition** — Describing what an agent looks like. An Agent node connected to MCP Server and Toolset nodes. The graph is walked once at build time to produce an Agno Agent/Team. Agno handles the actual execution. This is what we have today.

**Flow execution** — Describing what happens. A prompt feeds into an LLM, the output routes through a classifier, branches hit different endpoints. Data actually flows through edges at runtime. The backend executes nodes in order.

These coexist in a single canvas, in a single graph. The user doesn't think about modes — they just wire things together. The engine figures out which nodes are structural and which are flow by looking at what's connected.

### The Agent Node Bridges Both

An Agent node is structural when tools and sub-agents plug into it. It's a flow node when it sits in a data pipeline receiving messages and producing responses. The same node, participating in both phases:

```
Phase 1 (Build): Walk structural edges → compile Agent/Team
Phase 2 (Run):   Execute flow nodes in order → pass data through edges
```

If the graph has no flow nodes, Phase 2 is skipped entirely — the agent runs directly, exactly like today.

## The Plugin Directory

Every node is a folder. Frontend definition and backend executor live side by side:

```
nodes/
  _registry.py              # Python auto-discovery engine
  _registry.ts              # TypeScript barrel exports
  _types.py                 # Python executor protocol + event types
  _types.ts                 # Moved from app/lib/flow/types.ts

  core/
    chat-start/
      definition.ts         # Parameters, sockets, icon, category
      executor.py           # Entry point bridge — connects chat to graph

    agent/
      definition.ts
      executor.py           # Builds Agno Agent/Team (structural), runs agent (flow)

  tools/
    mcp-server/
      definition.ts
      executor.py           # Resolves MCP tools via registry

    toolset/
      definition.ts
      executor.py           # Resolves toolset tools via registry

  ai/
    llm-completion/
      definition.ts
      executor.py           # Single LLM call — prompt in, text out

    structured-output/
      definition.ts
      executor.py           # LLM with JSON schema enforcement

    classifier/
      definition.ts
      executor.py           # Classify input, route to branches

    prompt-template/
      definition.ts
      executor.py           # Variable interpolation into a template string

  flow/
    conditional/
      definition.ts
      executor.py           # If/else routing

    loop/
      definition.ts
      executor.py           # Repeat sub-path N times or until condition

    merge/
      definition.ts
      executor.py           # Wait for multiple inputs

    code/
      definition.ts
      executor.py           # Run Python code

  data/
    json-transform/
      definition.ts
      executor.py           # Reshape JSON objects

    filter/
      definition.ts
      executor.py           # Filter arrays by condition

    text-split/
      definition.ts
      executor.py           # Split/join text

    type-converter/
      definition.ts
      executor.py           # Explicit type conversion

  integration/
    http-request/
      definition.ts
      executor.py           # Make HTTP calls

    webhook-trigger/
      definition.ts
      executor.py           # Listen for incoming HTTP

    database-query/
      definition.ts
      executor.py           # SQL/NoSQL queries

  rag/
    document-loader/
      definition.ts
      executor.py           # Load PDFs, web pages, text files

    text-chunker/
      definition.ts
      executor.py           # Split documents for embedding

    embedding/
      definition.ts
      executor.py           # Text to vector

    vector-search/
      definition.ts
      executor.py           # Query vector databases
```

The subdirectories (`core/`, `tools/`, `ai/`, `flow/`, `data/`, `integration/`, `rag/`) are organizational — they map to the node palette categories. Discovery scans recursively for `definition.ts` / `executor.py` pairs regardless of depth.

## Discovery

### Python: Convention-Based Auto-Discovery

Modeled directly on the providers system. `_registry.py` scans the `nodes/` tree at import time:

```python
# nodes/_registry.py
# Walks nodes/**/executor.py, imports each, extracts the executor class

EXECUTORS: dict[str, NodeExecutor] = {}

for executor_path in Path(__file__).parent.rglob("executor.py"):
    module = import_module(executor_path)
    executor = getattr(module, "executor", None)
    if executor and hasattr(executor, "node_type"):
        EXECUTORS[executor.node_type] = executor

def get_executor(node_type: str) -> NodeExecutor | None:
    return EXECUTORS.get(node_type)
```

Drop a folder with an `executor.py`, restart, it appears. No central list. No if/elif dispatch.

### TypeScript: Explicit Imports

The frontend uses a simple import list — the same proven pattern from the current `NODE_LIST` and the providers `ProviderRegistry.ts`. Auto-discovery in TypeScript/Next.js adds build complexity without proportional benefit. Adding one import line is near-zero friction:

```typescript
// nodes/_registry.ts
import { definition as chatStart } from './core/chat-start/definition';
import { definition as agent } from './core/agent/definition';
import { definition as mcpServer } from './tools/mcp-server/definition';
// ...

const ALL_NODES = [chatStart, agent, mcpServer, ...] as const;

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = Object.fromEntries(
  ALL_NODES.map(n => [n.id, n])
);
```

## The Executor Contract

### The Universal Rule

Every node, regardless of type, does exactly one thing: **receive values on input ports, execute, produce values on output ports.** That's the entire abstraction. There are no special protocols for flow control, no callback interfaces for routing, no framework hooks for branching. Just inputs in, outputs out.

This single rule handles every node type:

| Node | What happens |
|------|-------------|
| **JSON Transform** | Receives JSON, produces JSON. Both output ports fire. |
| **LLM Completion** | Receives prompt, streams tokens as events, produces text. |
| **HTTP Request** | Receives URL/body, makes call, produces response. |
| **Conditional** | Receives data, evaluates condition, produces data on `true` OR `false` port. The other port stays empty. |
| **Filter** | Receives array, produces matching items on `pass` AND non-matching on `reject`. Either can be empty. |
| **Merge** | Engine waits until all required inputs arrive, then calls execute. Node just combines them. |
| **Trigger** | No input ports. Activated externally. Produces initial data on output ports. |
| **Agent (flow mode)** | Receives messages, runs agentic loop internally, produces response messages. |

Flow control isn't a special protocol — it's **which output ports have values**. The engine follows edges from ports that produced data. Empty ports = branches that don't execute. A conditional doesn't "tell the engine which branch to take." It just puts data on one port. The engine does the rest.

### The Executor Protocol

Every `executor.py` exports an `executor` object. There are two methods a node can implement — `build()` for structural composition and `execute()` for runtime data flow. A node implements one or both.

```python
class NodeExecutor(Protocol):
    node_type: str    # Must match definition.ts id

    # --- Structural (Phase 1) ---
    # Implement this if the node participates in agent composition.
    # Called once at graph compile time.

    def build(
        self,
        data: dict[str, Any],
        context: BuildContext,
    ) -> StructuralResult: ...

    # --- Flow (Phase 2) ---
    # Implement this if the node processes data at runtime.
    # Called during flow execution.

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult: ...
```

Both methods are optional — the registry detects which a node implements. Structural-only nodes (MCP Server, Toolset) implement `build()`. Flow-only nodes (HTTP Request, Conditional) implement `execute()`. Hybrid nodes (Agent) implement both.

### ExecutionResult

The return type is the same for every node. No special cases.

```python
@dataclass
class ExecutionResult:
    outputs: dict[str, DataValue]    # Values on output ports. Missing port = no data = dead branch.
    events: list[NodeEvent]          # Events emitted during execution (for chat UI / canvas).
```

For **streaming nodes** (LLM, Agent), `execute()` is an async generator that yields `NodeEvent`s during execution. The final result is the `ExecutionResult` with outputs. The engine collects events as they stream and forwards them to the chat UI in real-time.

```python
async def execute(self, data, inputs, context) -> AsyncIterator[NodeEvent | ExecutionResult]:
    # Yield events as work progresses
    yield NodeEvent(node_id=context.node_id, event_type="started", ...)
    yield NodeEvent(node_id=context.node_id, event_type="progress", ...)  # token, etc.

    # Final yield is always the result
    yield ExecutionResult(
        outputs={"response": DataValue(type="text", value="...")},
        events=[],
    )
```

For **synchronous nodes** (transforms, conditionals), `execute()` returns immediately:

```python
async def execute(self, data, inputs, context) -> ExecutionResult:
    result = transform(inputs["data"].value)
    return ExecutionResult(
        outputs={"output": DataValue(type="json", value=result)},
        events=[],
    )
```

Same signature, same return type. The engine handles both.

### BuildContext and FlowContext

```python
@dataclass
class BuildContext:
    node_id: str
    chat_id: str | None
    connected_tool_sources: list[ToolSourceInfo]   # MCP/toolset nodes wired in
    connected_sub_agents: list[SubAgentInfo]        # Agent nodes wired as tools
    tool_registry: ToolRegistry

@dataclass
class FlowContext:
    node_id: str
    chat_id: str | None
    run_id: str                              # Correlates all events in this execution
    state: FlowState                         # Shared mutable state for this run
    agent: Agent | Team | None               # Built in Phase 1, available to flow nodes
    tool_registry: ToolRegistry
```

### StructuralResult

```python
@dataclass
class ToolsResult:
    tools: list[Callable]

@dataclass
class AgentResult:
    agent: Agent | Team

@dataclass
class MetadataResult:
    metadata: dict[str, Any]

StructuralResult = ToolsResult | AgentResult | MetadataResult
```

### How Every Node Type Maps to This

**Pure transform** — Simplest case. Synchronous, instant:

```python
# nodes/data/json-transform/executor.py
class JsonTransformExecutor:
    node_type = "json-transform"

    async def execute(self, data, inputs, context):
        expression = data.get("expression", "")
        result = evaluate_jsonata(expression, inputs["input"].value)
        return ExecutionResult(
            outputs={"output": DataValue(type="json", value=result)},
            events=[],
        )

executor = JsonTransformExecutor()
```

**Conditional** — Not special. Just selective output ports:

```python
# nodes/flow/conditional/executor.py
class ConditionalExecutor:
    node_type = "conditional"

    async def execute(self, data, inputs, context):
        value = inputs["input"].value
        condition_met = evaluate_condition(data, value)

        outputs = {}
        if condition_met:
            outputs["true"] = inputs["input"]   # data flows to true branch
        else:
            outputs["false"] = inputs["input"]  # data flows to false branch
        # The missing port = dead branch. Engine skips those edges.

        return ExecutionResult(outputs=outputs, events=[])

executor = ConditionalExecutor()
```

**LLM Completion** — Async, streams tokens:

```python
# nodes/ai/llm-completion/executor.py
class LlmCompletionExecutor:
    node_type = "llm-completion"

    async def execute(self, data, inputs, context):
        model = resolve_model(data["model"])
        prompt = inputs.get("prompt", DataValue(type="text", value="")).value

        yield NodeEvent(node_id=context.node_id, event_type="started",
                        data={"model": data["model"]})

        full_response = ""
        async for token in model.astream(prompt):
            full_response += token
            yield NodeEvent(node_id=context.node_id, event_type="progress",
                            data={"token": token})

        yield ExecutionResult(
            outputs={"text": DataValue(type="text", value=full_response)},
            events=[],
        )

executor = LlmCompletionExecutor()
```

**HTTP Request** — Async I/O:

```python
# nodes/integration/http-request/executor.py
class HttpRequestExecutor:
    node_type = "http-request"

    async def execute(self, data, inputs, context):
        url = data.get("url", "") or inputs.get("url", DataValue("string", "")).value
        method = data.get("method", "GET")

        yield NodeEvent(node_id=context.node_id, event_type="started",
                        data={"method": method, "url": url})

        async with httpx.AsyncClient(timeout=data.get("timeout", 30)) as client:
            response = await client.request(method, url,
                json=inputs.get("body", DataValue("json", None)).value,
                headers=data.get("headers", {}))

        outputs = {}
        if response.is_success:
            outputs["response"] = DataValue(type="json", value=response.json())
            outputs["status"] = DataValue(type="int", value=response.status_code)
        else:
            outputs["error"] = DataValue(type="json", value={
                "status": response.status_code, "body": response.text
            })

        yield ExecutionResult(outputs=outputs, events=[])

executor = HttpRequestExecutor()
```

**Agent (hybrid — structural + flow):**

```python
# nodes/core/agent/executor.py
class AgentExecutor:
    node_type = "agent"

    def build(self, data, context):
        """Phase 1: Compile into an Agno Agent or Team."""
        model = resolve_model(data["model"])
        tools = []
        for source in context.connected_tool_sources:
            tools.extend(source.tools)

        if not context.connected_sub_agents:
            return AgentResult(agent=Agent(
                name=data.get("name", "Agent"),
                model=model,
                tools=tools or None,
                instructions=[data["instructions"]] if data.get("instructions") else None,
                markdown=True, stream_events=True,
            ))

        members = [sa.agent for sa in context.connected_sub_agents]
        return AgentResult(agent=Team(
            name=data.get("name", "Agent"),
            model=model, members=members,
            tools=tools or None,
            markdown=True, stream_events=True, stream_member_events=True,
        ))

    async def execute(self, data, inputs, context):
        """Phase 2: Run the agent with input data."""
        messages = inputs.get("messages_in", DataValue("message", "")).value

        # Use agent from Phase 1 if available, otherwise build fresh
        agent = context.agent or self.build(data, BuildContext(...)).agent

        yield NodeEvent(node_id=context.node_id, event_type="started",
                        data={"agent": data.get("name", "Agent")})

        async for event in agent.arun(messages, stream=True, stream_events=True):
            yield NodeEvent(node_id=context.node_id, event_type="agent_event",
                            data={"agno_event": event})

        yield ExecutionResult(
            outputs={"messages_out": DataValue(type="message", value=agent.run_response.content)},
            events=[],
        )

executor = AgentExecutor()
```

**Trigger (entry node):**

```python
# nodes/core/chat-start/executor.py
class ChatStartExecutor:
    node_type = "chat-start"

    def build(self, data, context):
        """Phase 1: Provide metadata (includeUserTools)."""
        return MetadataResult(metadata={
            "includeUserTools": data.get("includeUserTools", False),
        })

    async def execute(self, data, inputs, context):
        """Phase 2: Emit user message into the flow."""
        # The engine provides the user message via context
        return ExecutionResult(
            outputs={"message": DataValue(type="message", value=context.state.user_message)},
            events=[],
        )

executor = ChatStartExecutor()
```

Every node. Same shape. No special cases.

## The Definition Contract

`definition.ts` stays exactly as today — the `NodeDefinition` interface is already well-designed. One addition: `executionMode` tells the frontend (and the engine) how this node participates:

```typescript
interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  category: NodeCategory;
  icon: string;
  parameters: readonly Parameter[];

  /** How this node executes. Default: 'structural' */
  executionMode?: 'structural' | 'flow' | 'hybrid';
}

type NodeCategory = 'core' | 'tools' | 'ai' | 'flow' | 'data' | 'integration' | 'rag' | 'trigger';
```

A definition file looks the same as today:

```typescript
// nodes/integration/http-request/definition.ts
import type { NodeDefinition } from '../../_types';

export const definition = {
  id: 'http-request',
  name: 'HTTP Request',
  description: 'Make HTTP calls to external APIs',
  category: 'integration',
  icon: 'Globe',
  executionMode: 'flow',

  parameters: [
    { id: 'method', type: 'enum', label: 'Method', mode: 'constant',
      values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { id: 'url', type: 'string', label: 'URL', mode: 'hybrid',
      placeholder: 'https://api.example.com/data',
      socket: { type: 'string' } },
    { id: 'headers', type: 'json', label: 'Headers', mode: 'constant', default: {} },
    { id: 'body', type: 'json', label: 'Body', mode: 'hybrid',
      socket: { type: 'json', side: 'left' } },
    { id: 'timeout', type: 'int', label: 'Timeout (s)', mode: 'constant',
      default: 30, min: 1, max: 300 },
    { id: 'response', type: 'json', label: 'Response', mode: 'output',
      socket: { type: 'json' } },
    { id: 'status', type: 'int', label: 'Status', mode: 'output',
      socket: { type: 'int' } },
    { id: 'error', type: 'json', label: 'Error', mode: 'output',
      socket: { type: 'json' } },
  ],
} as const satisfies NodeDefinition;
```

## The Socket Type System

### Existing Types (preserved)

| Type | Color | Shape | Purpose |
|------|-------|-------|---------|
| `agent` | Purple #7c3aed | Circle | Agent topology |
| `tools` | Amber #f59e0b | Square | Tool connections |
| `float` | Gray #a1a1aa | Circle | Decimal numbers |
| `int` | Dark gray #71717a | Circle | Integers |
| `string` | Blue #3b82f6 | Circle | Short strings |
| `boolean` | Green #10b981 | Diamond | True/false |
| `color` | Yellow #eab308 | Circle | Color values |

### New Types (for data flow)

| Type | Color | Shape | Purpose |
|------|-------|-------|---------|
| `json` | Orange #f97316 | Circle | Structured objects |
| `text` | Cyan #06b6d4 | Circle | Long-form text content |
| `binary` | Pink #ec4899 | Square | File/blob references |
| `array` | Violet #8b5cf6 | Square | Ordered lists |
| `message` | Light purple #a855f7 | Circle | Chat messages `{role, content}` |
| `document` | Lime #84cc16 | Square | `{text, metadata}` for RAG |
| `vector` | Teal #14b8a6 | Diamond | Embedding vectors |
| `trigger` | Red #ef4444 | Diamond | Execution signal (no data) |
| `any` | Neutral #6b7280 | Circle (dashed) | Wildcard — accepts anything |

### Type Coercion

Safe implicit coercions (validated at link time, performed at runtime):

```
int      -> float     (lossless)
int      -> string    (toString)
float    -> string    (toString)
boolean  -> string    ("true"/"false")
string   -> text      (identity)
text     -> string    (identity)
json     -> string    (JSON.stringify)
json     -> text      (JSON.stringify pretty)
document -> text      (extract .text)
document -> json      (full object)
*        -> any       (always accepted)
any      -> *         (runtime coercion attempt)
```

Incompatible connections are blocked in the editor. A Type Converter node exists for explicit conversions the coercion table doesn't cover.

## Runtime Data Value

What actually flows through edges at runtime — a discriminated union:

```python
@dataclass
class DataValue:
    type: str           # matches SocketTypeId
    value: Any          # type-specific payload

# Examples:
DataValue(type="string", value="hello")
DataValue(type="json", value={"status": 200, "data": [...]})
DataValue(type="message", value={"role": "user", "content": "..."})
DataValue(type="binary", value=BinaryRef(ref="tmp/abc123", mime="application/pdf", size=102400))
DataValue(type="trigger", value=None)
```

Large data (files, images) flows as `BinaryRef` — a pointer to content stored on disk, not the bytes themselves. This keeps the graph lightweight regardless of payload size.

## Execution Variation

Despite the universal `execute()` contract, nodes vary in how they use it. These are the natural families:

| Family | Examples | Behavior | Streaming? | Duration |
|--------|----------|----------|------------|----------|
| **Pure transforms** | JSON Transform, Filter, Regex, Type Converter, Text Split | Synchronous computation. Data in, data out. No side effects. | No | Instant |
| **LLM / AI** | LLM Completion, Structured Output, Classifier, Agent (flow) | Async API calls. Stream tokens. Internal loops (agent). | Yes — token events | Seconds to minutes |
| **I/O** | HTTP Request, Database Query, Email, File Read/Write | Async network/disk. Side effects. Need timeouts. | Sometimes (HTTP SSE) | Milliseconds to seconds |
| **Flow control** | Conditional, Switch, Filter | Evaluate a condition. Selectively populate output ports. | No | Instant |
| **Aggregation** | Merge, Aggregate | Wait for multiple inputs. Combine. | No | Depends on slowest input |
| **Containers** | Loop, For Each | Run an internal sub-graph. Proxy inputs/outputs. | Events from inner nodes | Depends on iterations |
| **Triggers** | Chat Start, Webhook, Schedule, File Watch | No inputs. Activated externally. Produce initial data. | No | N/A — activation |

All of these use the same `execute()` signature and return `ExecutionResult`. The variation is in what happens *inside* — sync vs async, instant vs long-running, single-output vs selective-output. But that's implementation detail, invisible to the engine.

The engine's only job: find nodes with satisfied inputs, call `execute()`, store outputs, repeat. Everything else is the node's problem.

## The Event Protocol

Every node emits `NodeEvent` objects during execution. These power the chat interface, the flow canvas animations, and debugging.

```python
@dataclass
class NodeEvent:
    node_id: str
    node_type: str
    event_type: str       # started | progress | completed | error | agent_event
    run_id: str           # correlates events across a single execution
    data: dict | None = None
    timestamp: float = field(default_factory=time.time)
```

### Event Types

| Event | Emitted When | `data` Shape |
|-------|-------------|--------------|
| `started` | Node begins executing | `{preview: "..."}` |
| `progress` | Intermediate update | `{percent: 0.5, message: "..."}` |
| `completed` | Node finished | `{outputs: {port: DataValue}, durationMs: 120}` |
| `error` | Node failed | `{error: "message", recoverable: bool}` |
| `agent_event` | Agent node wraps an Agno RunEvent | `{agno_event: {...}}` |

### How the Chat UI Renders Flow Events

The existing `content_blocks` system (text, reasoning, tool_call, member_run) gets a new block type:

```python
# A flow_step block, rendered as an expandable card in the chat
{
    "type": "flow_step",
    "node_id": "http-1",
    "node_type": "http-request",
    "node_name": "Fetch weather",
    "status": "completed",           # started | completed | error
    "summary": "GET api.weather.com → 200 OK",
    "detail": {"response": {...}},   # expandable
    "duration_ms": 340,
}
```

Agent nodes in flow mode emit their events as the existing `text`, `reasoning`, and `tool_call` blocks — full compatibility with the current chat rendering. The `agent_event` wrapper is only used internally to bridge Agno's event stream into the flow event protocol.

## The Graph Executor (Refactored)

`graph_executor.py` transforms from hardcoded dispatch to a two-phase engine that delegates to registered executors.

### Phase 1: Build (Structural)

Walk the structural subgraph (edges with `agent` or `tools` socket types) and compile each node via its executor's `build()` method:

```python
def build_from_graph(graph_data, chat_id, extra_tool_ids):
    nodes, edges = parse_graph(graph_data)

    # Partition: structural vs flow
    structural_nodes = find_structural_subgraph(nodes, edges)
    root_agent_id = find_root_agent_id(nodes, edges)

    # Build each structural node via its registered executor
    for node_id in topological_sort(structural_nodes, edges):
        node = nodes[node_id]
        executor = get_executor(node["type"])   # <-- registry lookup, not if/elif
        result = executor.build(node["data"], BuildContext(...))
        # ... compose results into Agent/Team
```

### Phase 2: Run (Flow)

If there are flow nodes, execute them. The engine is simple — it finds nodes whose inputs are satisfied, executes them, places their outputs on edges, and repeats.

```python
async def run_flow(graph_data, agent, chat_id, user_message):
    nodes, edges = parse_graph(graph_data)
    flow_nodes = find_flow_subgraph(nodes, edges)

    if not flow_nodes:
        return  # Pure structural graph — agent runs directly

    state = FlowState(agent=agent, user_message=user_message)
    port_values: dict[str, dict[str, DataValue]] = {}  # node_id -> {port: value}
    execution_order = topological_sort(flow_nodes, edges)

    for node_id in execution_order:
        node = nodes[node_id]
        executor = get_executor(node["type"])

        # Gather inputs: look at incoming edges, pull values from upstream output ports
        inputs = {}
        for edge in edges_targeting(node_id, edges):
            source_outputs = port_values.get(edge["source"], {})
            value = source_outputs.get(edge["sourceHandle"])
            if value is not None:
                inputs[edge["targetHandle"]] = value

        # Skip this node if required inputs are missing (dead branch from a conditional)
        if not has_required_inputs(node, inputs):
            continue

        # Execute — handle both sync (returns ExecutionResult) and streaming (yields events)
        result = await run_executor(executor, node["data"], inputs, FlowContext(...))

        # Store output port values for downstream nodes
        port_values[node_id] = result.outputs

        # Forward events to chat UI
        for event in result.events:
            emit_to_chat(event)
```

The key insight: the engine doesn't know about conditionals, filters, or branching. It just follows the data. If an upstream node didn't populate an output port, the edge from that port carries no data, and the downstream node's input isn't satisfied. The engine skips it. Branching emerges from the data, not from special engine logic.

### Graph Partitioning

The engine determines which subgraph is structural and which is flow by examining edge socket types:

```python
STRUCTURAL_SOCKET_TYPES = {"agent", "tools"}

def partition_graph(nodes, edges):
    structural_edges = [e for e in edges if get_socket_type(e) in STRUCTURAL_SOCKET_TYPES]
    flow_edges = [e for e in edges if get_socket_type(e) not in STRUCTURAL_SOCKET_TYPES]

    structural_nodes = nodes_reachable_via(structural_edges)
    flow_nodes = nodes_reachable_via(flow_edges)

    # Hybrid nodes (like Agent) appear in both sets — that's fine
    return structural_nodes, flow_nodes
```

## Error Handling

Three modes, progressively available per node:

1. **Stop flow** (default) — Error halts everything. The chat shows what failed and why.
2. **Continue on fail** — Failed node's error becomes its output data. Downstream nodes receive `{error: "..."}` and can inspect it.
3. **Error output** — Node has a dedicated error socket. Errors route to a separate branch. Success routes normally.

This is n8n's three-tier pattern — it scales from simple to sophisticated without requiring upfront complexity.

### Retry Policy

Per-node, opt-in:

```python
@dataclass
class RetryPolicy:
    max_attempts: int = 3
    initial_interval: float = 1.0
    backoff_factor: float = 2.0
    max_interval: float = 30.0
    retry_on: list[str] | None = None    # exception types, None = all transient
```

## Flow Control Is Just Data Routing

Flow control nodes aren't special. They follow the same universal rule — inputs in, execute, outputs out. The engine doesn't need to know about conditionals or merges. It just follows the data.

### Conditionals

A Conditional node has one input and two output ports (`true`, `false`). It evaluates a condition and puts data on one port. The other port stays empty. The engine follows edges from ports that have values. Empty ports = branches that don't execute.

No skip tokens needed. No special engine support. The engine already only follows edges from populated output ports.

### Switch / Router

Same pattern, more ports. A Switch node has N output ports (one per case). Data lands on exactly one. The engine follows that edge. All other branches are naturally dead.

### Filter

Both ports can fire. `pass` gets matching items, `reject` gets non-matching. If nothing matches, `pass` is empty. If everything matches, `reject` is empty. Downstream nodes on either branch only execute if their input port received data.

### Merge

The Merge node has multiple input ports. The engine already tracks "are all required inputs satisfied?" for every node. Merge just has multiple required inputs — it doesn't execute until enough arrive.

The one subtlety: when a branch was killed by a conditional (no data on that path), the merge can't wait forever. The engine tracks **reachability** — if a merge input's upstream path has no data flowing through it, that input is marked as "will not arrive" and the merge fires without it.

### Loops

Loops create cycles, which break topological sort. The solution: **container loops**. A Loop node contains an internal sub-graph. From the outer graph's perspective, it's just a node — inputs in, execute (internally runs the sub-graph N times), outputs out. The outer graph stays a DAG.

Agent-style loops (think → tool_call → observe → think) are NOT modeled as flow loops. They happen inside the Agent node via Agno's built-in agentic loop. The Agent node handles this internally — from the flow's perspective, the agent just took a while and produced output.

## Chat Start: The Bridge Node

Chat Start is the bridge between the chat interface and the graph. In structural-only graphs, it does what it does today — marks the entry point. In flow graphs, it becomes the first flow node:

1. Receives user messages from the chat interface
2. Emits them as `message` DataValues into the flow
3. Collects `flow_step` events from all downstream nodes
4. Renders them in the chat as expandable cards

It also carries configuration that affects the whole graph: `includeUserTools` (merge user-selected tools into the root agent), and potentially `showFlowSteps` (whether intermediate flow events appear in chat or just the final output).

## What This Enables

- **Drop-in nodes** — Add a folder, restart, it works. Both frontend and backend.
- **Agent composition** — Wire agents with tools, sub-agents, MCP servers (today's model, preserved).
- **Data pipelines** — Chain LLM calls, transform data, route conditionally (n8n-style).
- **Hybrid flows** — An agent with tools AND a processing pipeline around it.
- **RAG pipelines** — Load documents, chunk, embed, search — as visual nodes.
- **External integrations** — HTTP, webhooks, databases, email — all as nodes.
- **Flow control** — Conditionals, loops, merges — for complex orchestration.
- **Consistent rendering** — Every node emits events to the chat. The user sees everything happening.

## Implementation Order

1. **Foundation** — Create `nodes/` directory, `_types.py`, `_types.ts`, `_registry.py`, `_registry.ts`. Migrate existing 4 nodes (chat-start, agent, mcp-server, toolset). Refactor `graph_executor.py` to use registry. Verify everything still works exactly as before.

2. **Flow engine** — Add Phase 2 execution (topological sort of flow nodes). Add `FlowContext`, `FlowState`, `DataValue`. Wire `NodeEvent` through to the chat interface as `flow_step` content blocks.

3. **First flow nodes** — LLM Completion (simplest — prompt in, text out), Prompt Template (variable interpolation), Conditional (branching).

4. **Prove the hybrid** — Agent node gets `messages_in`/`messages_out` sockets for flow mode. Build a demo: user message → template → agent → conditional → different responses.

5. **Data nodes** — JSON Transform, Filter, Type Converter, Text Split.

6. **Integration nodes** — HTTP Request, Webhook Trigger.

7. **RAG nodes** — Document Loader, Text Chunker, Embedding, Vector Search.

8. **Advanced flow** — Loop, Merge, error output routing, retry policies.

Step 1 is a pure refactor — zero behavior change, just better organization. Every step after adds new capability without breaking existing functionality.
