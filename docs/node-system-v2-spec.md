# Node System v2 Specification

This document describes the architecture for a general-purpose visual node system. The design prioritizes composability, extensibility, and minimal core concepts. Rather than building special cases for tools, loops, or foreign integrations, the system provides five primitives from which all patterns emerge naturally.

## Design Philosophy

The current node architecture grew organically around specific use cases. Tools became a special connection type. Agents got custom execution semantics. The result is a system where each new capability requires new special cases.

This specification inverts that approach. We identify the smallest set of primitives that, when composed, can express any node behavior. Tools, loops, parallel execution, foreign system integration, runtime observation, and approval gates all become ordinary applications of the same core concepts.

The five primitives are:

1. **Event Processes** — Nodes are stateful processes with lifecycle, not pure functions
2. **Ports** — Typed connection points with explicit data flow semantics
3. **Schemas** — Namespaced type definitions for connection compatibility
4. **Regions** — Bounded subgraphs with explicit entry and exit points
5. **Runtime** — Observable and controllable execution environment

Each primitive is simple in isolation. Their power comes from composition.

---

## Primitive 1: Event Processes

A node is not a pure function that transforms inputs to outputs. A node is a stateful process that runs over time, emits events, and can respond to external signals.

### Lifecycle

When a node executes, it enters a running state. During execution it may emit progress events, request approvals, stream partial results, or report state changes. It can also receive events from outside — stop signals, pause requests, injected data from supervisors, or responses to approval requests. Eventually the node completes (emitting final outputs) or is terminated.

This model accommodates both simple transform nodes (which emit a single completion event almost immediately) and long-running processes (like an agent that may run for minutes, pausing for tool calls and approvals).

### Events

Events are the universal communication mechanism. Everything that happens during execution is an event:

- Node started
- Progress update (partial results, status changes)
- Tool call requested
- Approval required
- External data received
- Node completed with outputs
- Node errored
- Node cancelled

Events flow in both directions. A node emits events outward (to the runtime, to observers, to connected nodes). A node can also subscribe to events and react to them mid-execution.

### Event Filtering

Nodes declare what events they emit and what events they wish to receive. Event types follow a namespacing convention — core events use simple names (`progress`, `error`) while custom events use namespaced names (`gmail:rate_limited`, `comfyui:queue_position`).

Subscriptions can filter by node instance ID, node type, node type patterns (e.g., `comfyui:*` for all ComfyUI nodes), event type, or event type patterns (e.g., `comfyui:*` for all ComfyUI-namespaced events). This enables powerful patterns like observability nodes that watch all activity, supervisors that monitor specific node types, or dashboards that track events from an entire foreign system.

```ts
events: {
  emits: ['progress', 'tool_call', 'gmail:rate_limited'],
  accepts: ['stop', 'pause', 'approval_response'],
}
```

The runtime routes events based on subscriptions. Nodes only receive events matching their filters. See the Event System section for full details on filtering syntax.

---

## Primitive 2: Ports

Ports are connection points on nodes. Each port has a direction, a mode, and a schema.

### Direction

A port is either an input (`in`) or an output (`out`). Outputs connect to inputs. You cannot connect two inputs or two outputs directly.

### Mode

Mode determines what flows through the connection and who controls execution:

**Value mode** is the default data flow. When the source node completes, its output value is delivered to the target node's input. The runtime controls when execution happens — it runs nodes in topological order based on dependencies.

```ts
{ id: 'text', direction: 'in', mode: 'value', schema: { type: 'string' } }
```

**Reference mode** gives the target a handle to invoke the source. The source doesn't execute automatically. The target decides when (and whether) to call it, and with what inputs. This is how tools work — the agent receives callable handles and invokes them when the LLM requests.

```ts
{ id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'tool' }, multiple: true }
```

**Structural mode** gives the target full access to a region of the graph. The target receives the region's definition, configuration, all internal nodes and edges, and the ability to invoke it. The target becomes the executor for that region — the runtime skips those nodes in its normal topological pass.

```ts
{ id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } }
```

### Multiple Connections

By default, a port accepts one connection. Setting `multiple: true` allows multiple connections. For inputs, this means receiving multiple values (for `value` mode) or multiple handles (for `reference` mode). The executor receives these as arrays.

### Port Definition

```ts
interface Port {
  id: string;
  direction: 'in' | 'out';
  mode: 'value' | 'reference' | 'structural';
  schema: Schema;
  multiple?: boolean;
}
```

---

## Primitive 3: Schemas

Schemas define the shape of data that flows through ports. They enable connection-time validation and provide structure for auto-generating tool parameters, validating data, and enabling IDE-like features in expression editors.

### Built-in Types

The system provides primitive types:

- `string` — Text
- `number` — Numeric values (integer or floating point)
- `boolean` — True or false
- `binary` — Raw bytes (files, images, audio)
- `array` — Ordered collection with typed items
- `object` — Key-value structure with typed properties
- `any` — Accepts anything (escape hatch)
- `function` — A callable

### Namespaced Types

Plugins and nodes can define custom types using namespaced identifiers. The namespace prevents collisions between different systems:

- `core:tool` — The standard tool type
- `gmail:email` — An email message from Gmail
- `comfyui:image` — An image in ComfyUI's format
- `slack:message` — A Slack message

The namespace is typically the plugin or provider ID. Core types use `core:` or can omit the namespace entirely for built-in types.

### Schema Structure

Schemas follow a JSON-Schema-like structure:

```ts
interface Schema {
  type: string;
  items?: Schema;                        // For arrays
  properties?: Record<string, Schema>;   // For objects
  required?: string[];                   // Required object properties
}
```

Examples:

```ts
// Simple string
{ type: 'string' }

// Array of numbers
{ type: 'array', items: { type: 'number' } }

// Object with specific shape
{
  type: 'object',
  properties: {
    name: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['name']
}

// Custom namespaced type
{ type: 'gmail:email' }
```

### The Tool Type

Tools are a common pattern, so we define a standard shape:

```ts
// core:tool
{
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    inputSchema: { type: 'object' },   // JSON Schema for tool arguments
    outputSchema: { type: 'object' },  // JSON Schema for tool result
    invoke: { type: 'function' },      // The callable
  },
  required: ['name', 'invoke']
}
```

Any node can output tools. Any node can consume tools via reference-mode connections. The Agent node is just one consumer — others could include testing harnesses, documentation generators, or tool routers.

### Connection Compatibility

When connecting ports, the system checks schema compatibility:

1. Exact type match is always valid
2. Coercible types are valid (e.g., `number` to `string`)
3. `any` accepts everything
4. Array inputs can accept single items (auto-wrapped)
5. Custom types match by exact namespace:id

Reference and structural mode inputs accept any schema — they receive handles or regions, not raw values.

---

## Primitive 4: Regions

A region is a bounded subgraph with explicit entry and exit points. Regions enable subgraph reuse, structural ownership, and visual grouping.

### Boundaries

Every region has two special boundary nodes:

**Entry node** defines the region's inputs. Its output ports flow into the region. When the region is invoked, values are injected through the entry node's outputs.

**Exit node** defines the region's outputs. Its input ports receive from the region. When the region completes, values are collected from the exit node's inputs.

The exit node also has a special output port of type `region` that emits a handle to the entire region. This handle can be connected elsewhere for invocation.

### Visual Modes

Regions can be displayed in two ways:

**Subgraph mode** collapses the region into a single node. The external node's ports mirror the entry and exit boundaries. Double-clicking opens the subgraph for editing. This is clean and compact but hides the internal structure.

**Closure zone mode** keeps the region visible inline in the parent graph. The entry and exit nodes are visible, with internal nodes between them. A visual boundary (box or highlight) distinguishes the zone. The exit node's region output connects to Evaluate nodes elsewhere in the graph. This enables visual debugging and multiple invocation points for the same region.

### Region Invocation

When a node receives a region (via structural mode connection), it can invoke that region:

```python
result = await runtime.execute_region(
    region=regions['body'],
    inputs={'item': current_item}
)
# result contains values from the exit node's ports
```

The runtime handles execution: it injects inputs through the entry node, runs all internal nodes in correct order, collects outputs from the exit node, and returns them.

A region can be invoked multiple times with different inputs. Each invocation is independent.

### Evaluate Nodes

An Evaluate node is a simple consumer of region handles. It receives a region reference and exposes ports matching the region's interface. Connecting inputs and reading outputs invokes the region.

This pattern separates definition (the closure zone) from invocation (the evaluate nodes). You can define a region once and invoke it from multiple places.

### Foreign Subgraphs

Some subgraphs contain nodes from external systems — ComfyUI, n8n, or custom engines. These use a bridge:

```ts
subgraph: {
  type: 'foreign',
  bridge: 'comfyui',
}
```

The bridge translates between our event/execution model and the foreign system. When executing a foreign subgraph, the runtime delegates to the bridge:

```python
result = await runtime.execute_foreign(
    bridge='comfyui',
    graph=subgraph_definition,
    inputs=inputs
)
```

Inside a foreign subgraph, nodes are defined by the foreign system. They may have custom rendering, custom connection rules, and custom execution semantics. The bridge handles all translation.

### Subgraph Node Constraints

When you enter a subgraph (double-click to edit), the subgraph defines what nodes are available and how they render.

**Native subgraphs** (`type: 'native'`) use the standard node palette. Any node from the main system can be placed inside. Entry and Exit boundary nodes define the interface.

**Foreign subgraphs** (`type: 'foreign'`) are constrained to nodes provided by the bridge. The node picker only shows nodes from that bridge — you cannot mix ComfyUI nodes with native nodes in the same subgraph.

The bridge is responsible for:

1. **Providing node definitions** — The bridge fetches or defines available nodes
2. **Custom rendering** — Each node can specify custom React components for its UI
3. **Connection rules** — The bridge defines socket types and what can connect to what
4. **Execution** — The bridge handles running the subgraph in the foreign system

```ts
interface Bridge {
  id: string;
  name: string;
  
  // Fetch available node definitions
  getNodeDefinitions(): Promise<NodeDefinition[]>;
  
  // Execute a subgraph built with these nodes
  execute(graph: SubgraphData, inputs: Record<string, any>): AsyncIterator<Event | Result>;
  
  // Optional: custom connection validation
  canConnect?(source: Port, target: Port): boolean;
  
  // Optional: custom socket types for this bridge
  socketTypes?: SocketType[];
}
```

When editing a foreign subgraph:
- The node picker queries `bridge.getNodeDefinitions()` instead of the main registry
- Each node renders using its own `ui.node` component if provided
- Connection validation uses `bridge.canConnect()` if defined, falling back to schema matching
- Socket colors/shapes come from `bridge.socketTypes` if defined

This means a ComfyUI subgraph shows only ComfyUI nodes with ComfyUI's visual style, and connection rules match ComfyUI's type system. The user experience inside feels native to that system.

### Mixed Subgraphs (Future)

A potential extension is subgraphs that allow nodes from multiple sources. This would require:
- A way to specify which node sets are allowed
- Compatibility mapping between different type systems
- UI to distinguish nodes from different sources

For now, subgraphs are either fully native or fully foreign to keep the model simple.

---

## Primitive 5: Runtime

The runtime is the execution environment. It schedules nodes, routes events, and provides observation and control capabilities.

### Execution

The runtime's primary job is executing graphs. For simple value-mode connections, it runs nodes in topological order. When a node has structural connections, the runtime skips the owned regions — the owning node handles them via `execute_region`.

```ts
interface Runtime {
  // Execute a region with given inputs, return outputs
  execute_region(region: Region, inputs: Record<string, any>): Promise<Record<string, any>>;
  
  // Execute a foreign subgraph via bridge
  execute_foreign(bridge: string, graph: any, inputs: Record<string, any>): Promise<any>;
}
```

### Events

The runtime is an event bus. Nodes emit events to the runtime. Nodes subscribe to events through the runtime. The runtime routes events based on subscriptions.

```ts
interface EventFilter {
  nodeId?: NodeId;              // Specific node instance
  nodeType?: string;            // Node type, supports wildcards (e.g., 'comfyui:*')
  type?: string;                // Event type, supports wildcards (e.g., 'comfyui:*')
  or?: EventFilter[];           // Match any of these filters
  and?: EventFilter[];          // Match all of these filters
}

interface Runtime {
  // Emit an event
  emit(event: Event): void;
  
  // Subscribe to events matching a filter
  subscribe(filter: EventFilter): AsyncIterator<Event>;
}
```

Event filters support wildcards (`*`) for pattern matching. This enables subscribing to all events from a namespace (e.g., all `comfyui:*` event types) or all nodes of a type family (e.g., all `comfyui:*` node types). See the Event System section for detailed examples.

### Observation

The runtime tracks all active node processes and their states:

```ts
interface Runtime {
  // Get all currently running processes
  get_active_processes(): Map<NodeId, ProcessState>;
  
  // Get state of a specific node
  get_state(nodeId: NodeId): ProcessState;
  
  // Subscribe to state changes
  on_state_change(nodeId: NodeId, handler: StateHandler): Unsubscribe;
}
```

Process state includes: running/paused/completed/errored status, current progress, elapsed time, and any node-specific state the executor exposes.

### Control

The runtime provides control operations:

```ts
interface Runtime {
  // Pause a running node
  pause(nodeId: NodeId): void;
  
  // Resume a paused node
  resume(nodeId: NodeId): void;
  
  // Stop a node (cannot resume)
  stop(nodeId: NodeId): void;
  
  // Inject an event into a node
  inject_event(nodeId: NodeId, event: Event): void;
}
```

Injecting events is how external systems communicate with running nodes — approval responses, incoming webhooks, supervisor interventions.

### Durability

For long-running workflows (approval gates, scheduled tasks), the runtime supports persistence. It can serialize workflow state, store it durably, and restore execution later when triggered. This is implementation-specific but the runtime API accommodates it.

---

## Node Definition

A complete node definition:

```ts
interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  
  // Connection points
  ports: Port[];
  
  // UI configuration controls
  controls: Control[];
  
  // Events this node emits and accepts
  events?: {
    emits?: string[];
    accepts?: string[];
  };
  
  // If this node contains a subgraph
  subgraph?: {
    type: 'native' | 'foreign';
    bridge?: string;
  };
  
  // Custom UI components
  ui?: {
    node?: () => Promise<Component>;      // Custom node rendering
    config?: () => Promise<Component>;    // Custom config panel
    tools?: () => Promise<Component>;     // Tool editor panel
  };
}
```

### Controls

Controls define UI elements for node configuration:

```ts
interface Control {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'text' | 'code' | 'json' | 'custom';
  label: string;
  default?: any;
  options?: string[];          // For enum
  placeholder?: string;
  expressions?: boolean;       // Allow {{ }} expressions
  ui?: () => Promise<Component>;  // Custom control rendering
}
```

---

## Executor Implementation

The executor is a Python class that implements the node's behavior:

```python
class NodeExecutor:
    node_type: str = "my-node"
    
    async def execute(
        self,
        config: dict,                    # Values from UI controls
        inputs: dict,                    # From value-mode input ports
        refs: dict,                      # From reference-mode input ports
        regions: dict,                   # From structural-mode input ports
        runtime: Runtime,                # Execution environment
    ) -> AsyncIterator[Event | Result]:
        ...
```

The executor is an async generator. It yields events during execution and a final Result with output values.

### Value Inputs

Value-mode inputs arrive already resolved:

```python
text = inputs['text']  # The actual string value
items = inputs['items']  # The actual array
```

### Reference Inputs

Reference-mode inputs are invocable handles:

```python
tools = refs['tools']  # List of ToolHandle objects

for tool in tools:
    print(tool.name)
    print(tool.description)
    print(tool.input_schema)
    
    # Invoke the tool
    result = await tool.invoke({'query': 'search term'})
```

### Structural Inputs

Structural-mode inputs are Region objects:

```python
body = regions['body']

# Inspect the region
print(body.entry)       # Entry node definition
print(body.exit)        # Exit node definition
print(body.nodes)       # All internal nodes
print(body.edges)       # All internal edges

# Execute the region
result = await runtime.execute_region(body, {'item': data})
```

### Emitting Events

Yield events during execution:

```python
yield ProgressEvent(progress=0.5, message="Halfway done")
yield ToolCallEvent(tool='search', args={'q': 'test'})
```

### Receiving Events

Subscribe to events through the runtime:

```python
async for event in runtime.subscribe({'type': 'approval_response', 'request_id': my_id}):
    if event.approved:
        # Continue execution
        break
    else:
        # Handle rejection
        return
```

### Completing Execution

Yield a Result to complete:

```python
yield Result(outputs={
    'output': processed_data,
    'metadata': {'count': len(items)}
})
```

---

## Example Nodes

This section demonstrates how various node types are implemented using the five primitives. Each example validates that the system can cleanly express the required behavior.

### Example 1: Simple Transform Node

A basic node that transforms text to uppercase.

**Definition:**

```ts
{
  id: 'uppercase',
  name: 'Uppercase',
  category: 'transform',
  icon: 'Type',
  
  ports: [
    { id: 'text', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'result', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
  
  controls: [],
}
```

**Executor:**

```python
class UppercaseExecutor:
    node_type = "uppercase"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        text = inputs['text']
        yield Result(outputs={'result': text.upper()})
```

This is the simplest possible node. Value in, value out, no events, no references, no regions.

### Example 2: LLM Completion Node

A node that calls an LLM and streams the response.

**Definition:**

```ts
{
  id: 'llm-completion',
  name: 'LLM Completion',
  category: 'ai',
  icon: 'Sparkles',
  
  ports: [
    { id: 'prompt', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'response', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
  
  controls: [
    { id: 'model', type: 'enum', options: ['gpt-4', 'claude-3'], default: 'gpt-4' },
    { id: 'temperature', type: 'number', default: 0.7 },
  ],
  
  events: {
    emits: ['progress', 'token'],
  },
}
```

**Executor:**

```python
class LLMCompletionExecutor:
    node_type = "llm-completion"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        prompt = inputs['prompt']
        model = get_model(config['model'])
        
        full_response = ""
        async for token in model.stream(prompt, temperature=config['temperature']):
            full_response += token
            yield TokenEvent(token=token)
            yield ProgressEvent(partial=full_response)
        
        yield Result(outputs={'response': full_response})
```

This demonstrates event emission for streaming. The UI can subscribe to token events for real-time display.

### Example 3: Agent Node

An agent that uses tools based on LLM decisions.

**Definition:**

```ts
{
  id: 'agent',
  name: 'Agent',
  category: 'ai',
  icon: 'Bot',
  
  ports: [
    { id: 'message', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'core:tool' }, multiple: true },
    { id: 'response', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
  
  controls: [
    { id: 'model', type: 'enum', options: ['gpt-4', 'claude-3'] },
    { id: 'instructions', type: 'text', placeholder: 'System prompt' },
  ],
  
  events: {
    emits: ['tool_call_started', 'tool_call_completed', 'thinking', 'response'],
    accepts: ['stop', 'approval_response'],
  },
}
```

**Executor:**

```python
class AgentExecutor:
    node_type = "agent"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        message = inputs['message']
        tools = refs.get('tools', [])
        
        # Convert tool handles to LLM tool format
        llm_tools = [
            {
                'name': tool.name,
                'description': tool.description,
                'parameters': tool.input_schema,
            }
            for tool in tools
        ]
        
        model = get_model(config['model'])
        messages = [
            {'role': 'system', 'content': config['instructions']},
            {'role': 'user', 'content': message},
        ]
        
        while True:
            response = await model.chat(messages, tools=llm_tools)
            
            if response.tool_calls:
                for call in response.tool_calls:
                    yield ToolCallStartedEvent(tool=call.name, args=call.args)
                    
                    # Find and invoke the tool
                    tool = next(t for t in tools if t.name == call.name)
                    result = await tool.invoke(call.args)
                    
                    yield ToolCallCompletedEvent(tool=call.name, result=result)
                    messages.append({'role': 'tool', 'content': result, 'tool_call_id': call.id})
            else:
                yield Result(outputs={'response': response.content})
                return
```

The agent receives tools as reference-mode handles. It invokes them on demand based on LLM decisions. Each tool invocation is an event that observers can track.

### Example 4: Gmail Node with User-Configurable Tools

A node that provides Gmail operations and lets users configure which tools to expose.

**Definition:**

```ts
{
  id: 'gmail',
  name: 'Gmail',
  category: 'integration',
  icon: 'Mail',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'object' } },
    { id: 'output', direction: 'out', mode: 'value', schema: { type: 'object' } },
    { id: 'tools', direction: 'out', mode: 'value', schema: { type: 'array', items: { type: 'core:tool' } } },
  ],
  
  controls: [
    { id: 'credentials', type: 'custom', ui: () => import('./OAuthControl') },
    { id: 'operation', type: 'enum', options: ['send', 'search', 'archive', 'read'] },
    { id: 'query', type: 'string', expressions: true, placeholder: 'Search query' },
  ],
  
  ui: {
    tools: () => import('./GmailToolsPanel'),
  },
}
```

**Executor:**

```python
class GmailExecutor:
    node_type = "gmail"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        # If used as a direct operation
        if inputs.get('input'):
            result = await self.run_operation(config, inputs['input'])
            yield Result(outputs={'output': result})
            return
        
        # Build tools from configuration
        tools = self.build_tools(config, runtime)
        yield Result(outputs={'tools': tools})
    
    def build_tools(self, config, runtime):
        tools = []
        
        for tool_config in config.get('enabled_tools', []):
            async def invoke(args, tc=tool_config):
                # Run Gmail operation with tool's preset config + provided args
                merged_config = {**config, **tc['preset'], **args}
                return await self.run_operation(merged_config, args)
            
            tools.append({
                'name': tool_config['name'],
                'description': tool_config['description'],
                'input_schema': tool_config['schema'],
                'invoke': invoke,
            })
        
        return tools
    
    async def run_operation(self, config, input_data):
        operation = config['operation']
        if operation == 'search':
            return await self.search_emails(config['query'])
        elif operation == 'send':
            return await self.send_email(input_data)
        # ... other operations
```

The Gmail node outputs tools as data (value mode). When connected to an Agent's tools input (reference mode), the Agent receives invocable handles. The custom tools panel lets users enable/disable operations and create new tool configurations.

### Example 5: Loop Node

A node that executes a region repeatedly for each item in an array.

**Definition:**

```ts
{
  id: 'loop',
  name: 'Loop',
  category: 'flow',
  icon: 'Repeat',
  
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    { id: 'results', direction: 'out', mode: 'value', schema: { type: 'array' } },
  ],
  
  controls: [],
  
  events: {
    emits: ['iteration_started', 'iteration_completed'],
  },
}
```

**Executor:**

```python
class LoopExecutor:
    node_type = "loop"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        
        results = []
        for i, item in enumerate(items):
            yield IterationStartedEvent(index=i, total=len(items))
            
            result = await runtime.execute_region(body, inputs={'item': item, 'index': i})
            results.append(result.get('output'))
            
            yield IterationCompletedEvent(index=i, result=result)
        
        yield Result(outputs={'results': results})
```

The loop receives a region via structural mode. It doesn't re-implement execution — it asks the runtime to execute the region with specific inputs. This means nested loops, events, and all runtime features work correctly inside the body.

### Example 6: Parallel Execution Node

A node that executes a region concurrently for all items.

**Definition:**

```ts
{
  id: 'parallel',
  name: 'Parallel',
  category: 'flow',
  icon: 'GitBranch',
  
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    { id: 'results', direction: 'out', mode: 'value', schema: { type: 'array' } },
  ],
  
  controls: [
    { id: 'max_concurrent', type: 'number', default: 10 },
  ],
}
```

**Executor:**

```python
class ParallelExecutor:
    node_type = "parallel"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        max_concurrent = config.get('max_concurrent', 10)
        
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def run_one(item, index):
            async with semaphore:
                return await runtime.execute_region(body, inputs={'item': item, 'index': index})
        
        tasks = [run_one(item, i) for i, item in enumerate(items)]
        results = await asyncio.gather(*tasks)
        
        yield Result(outputs={'results': [r.get('output') for r in results]})
```

Same pattern as loop, but with concurrent execution. The runtime handles all the complexity.

### Example 7: ComfyUI Wrapper Node

A node that embeds a ComfyUI workflow.

**Definition:**

```ts
{
  id: 'comfyui-workflow',
  name: 'ComfyUI Workflow',
  category: 'integration',
  icon: 'Image',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'object' } },
    { id: 'output', direction: 'out', mode: 'value', schema: { type: 'comfyui:image' } },
  ],
  
  controls: [
    { id: 'server', type: 'string', default: 'http://localhost:8188' },
  ],
  
  subgraph: {
    type: 'foreign',
    bridge: 'comfyui',
  },
}
```

**Executor:**

```python
class ComfyUIWorkflowExecutor:
    node_type = "comfyui-workflow"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        subgraph = self.get_subgraph()
        
        yield ProgressEvent(message="Sending to ComfyUI...")
        
        result = await runtime.execute_foreign(
            bridge='comfyui',
            graph=subgraph,
            inputs=inputs['input'],
        )
        
        yield Result(outputs={'output': result})
```

Double-clicking the node opens the subgraph editor. Inside, nodes are ComfyUI nodes — fetched from ComfyUI's API, rendered with ComfyUI's custom UI. The bridge handles translation between our event model and ComfyUI's queue-based execution.

### Example 8: Runtime Inspector Node

A supervisor node that watches execution and can intervene.

**Definition:**

```ts
{
  id: 'runtime-inspector',
  name: 'Runtime Inspector',
  category: 'debug',
  icon: 'Eye',
  
  ports: [
    { id: 'agents', direction: 'in', mode: 'reference', schema: { type: 'any' }, multiple: true },
  ],
  
  controls: [
    { id: 'check_interval', type: 'number', default: 5000 },
    { id: 'idle_threshold', type: 'number', default: 30000 },
  ],
  
  events: {
    emits: ['intervention', 'status_report'],
    accepts: ['stop'],
  },
}
```

**Executor:**

```python
class RuntimeInspectorExecutor:
    node_type = "runtime-inspector"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        agents = refs.get('agents', [])
        interval = config['check_interval'] / 1000
        idle_threshold = config['idle_threshold'] / 1000
        
        while True:
            # Check for stop signal
            try:
                async for event in runtime.subscribe({'type': 'stop', 'target': self.node_id}):
                    yield Result(outputs={})
                    return
            except asyncio.TimeoutError:
                pass
            
            # Inspect all running processes
            processes = runtime.get_active_processes()
            
            for node_id, state in processes.items():
                if state.idle_time > idle_threshold:
                    yield InterventionEvent(
                        target=node_id,
                        reason='idle_timeout',
                        action='sending_continue_message',
                    )
                    
                    # Inject a continue event
                    runtime.inject_event(node_id, ContinueEvent(
                        message="You appear to be stuck. Please continue with your task."
                    ))
            
            await asyncio.sleep(interval)
```

This node runs alongside the workflow, observing and intervening. It uses runtime APIs to inspect process states and inject events. It's not part of the data flow — it's a supervisor.

### Example 9: Observability Node

A passive node that forwards all events to an external system.

**Definition:**

```ts
{
  id: 'observability',
  name: 'Observability',
  category: 'debug',
  icon: 'Activity',
  
  ports: [],
  
  controls: [
    { id: 'endpoint', type: 'string', placeholder: 'https://...' },
    { id: 'filter', type: 'enum', options: ['all', 'errors', 'tools', 'completions'] },
  ],
  
  events: {
    accepts: ['*'],  // Subscribe to everything
  },
}
```

**Executor:**

```python
class ObservabilityExecutor:
    node_type = "observability"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        endpoint = config['endpoint']
        filter_type = config['filter']
        
        event_filter = self.build_filter(filter_type)
        
        async for event in runtime.subscribe(event_filter):
            await self.forward_event(endpoint, event)
        
        # This node runs until the workflow completes
        yield Result(outputs={})
    
    async def forward_event(self, endpoint, event):
        async with aiohttp.ClientSession() as session:
            await session.post(endpoint, json=event.to_dict())
```

This node has no ports — it doesn't participate in data flow. It subscribes to events and forwards them. It runs for the lifetime of the workflow.

### Example 10: External Approval Gate

A node that pauses execution until external approval arrives.

**Definition:**

```ts
{
  id: 'approval-gate',
  name: 'Approval Gate',
  category: 'flow',
  icon: 'ShieldCheck',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'any' } },
    { id: 'approved', direction: 'out', mode: 'value', schema: { type: 'any' } },
    { id: 'rejected', direction: 'out', mode: 'value', schema: { type: 'any' } },
  ],
  
  controls: [
    { id: 'approvers', type: 'string', placeholder: 'email@example.com' },
    { id: 'timeout', type: 'number', default: 86400 },
    { id: 'message', type: 'text', expressions: true },
  ],
  
  events: {
    emits: ['approval_requested'],
    accepts: ['approval_response'],
  },
}
```

**Executor:**

```python
class ApprovalGateExecutor:
    node_type = "approval-gate"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        data = inputs['input']
        request_id = generate_id()
        
        # Send approval request
        await self.send_approval_email(
            to=config['approvers'],
            message=config['message'],
            request_id=request_id,
        )
        
        yield ApprovalRequestedEvent(request_id=request_id)
        
        # Wait for response
        try:
            async for event in runtime.subscribe({
                'type': 'approval_response',
                'request_id': request_id,
            }):
                if event.approved:
                    yield Result(outputs={'approved': data})
                else:
                    yield Result(outputs={'rejected': data})
                return
        except asyncio.TimeoutError:
            yield Result(outputs={'rejected': data})
```

This node pauses workflow execution. The runtime persists state. When an approval email is clicked, it triggers an event that the runtime routes to this node. Execution resumes.

### Example 11: Conditional Router

A node that routes data based on conditions.

**Definition:**

```ts
{
  id: 'conditional',
  name: 'Conditional',
  category: 'flow',
  icon: 'GitBranch',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'any' } },
    { id: 'true', direction: 'out', mode: 'value', schema: { type: 'any' } },
    { id: 'false', direction: 'out', mode: 'value', schema: { type: 'any' } },
  ],
  
  controls: [
    { id: 'field', type: 'string' },
    { id: 'operator', type: 'enum', options: ['equals', 'contains', 'greater_than', 'exists'] },
    { id: 'value', type: 'string', expressions: true },
  ],
}
```

**Executor:**

```python
class ConditionalExecutor:
    node_type = "conditional"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        data = inputs['input']
        field_value = get_field(data, config['field'])
        
        if self.evaluate(field_value, config['operator'], config['value']):
            yield Result(outputs={'true': data})
        else:
            yield Result(outputs={'false': data})
```

Simple routing. Only one output port receives data based on the condition.

### Example 12: Closure Zone with Evaluate

Using the closure pattern for reusable logic.

The closure zone consists of Entry and Exit boundary nodes with processing nodes between them. The Exit node's region output connects to one or more Evaluate nodes.

**Entry Node Definition:**

```ts
{
  id: 'region-entry',
  name: 'Entry',
  category: 'region',
  
  ports: [
    // User adds ports here to define region inputs
    // These appear as outputs (flowing into the region)
  ],
}
```

**Exit Node Definition:**

```ts
{
  id: 'region-exit',
  name: 'Exit',
  category: 'region',
  
  ports: [
    // User adds ports here to define region outputs
    // These appear as inputs (receiving from the region)
    
    // Always present: the region handle
    { id: 'region', direction: 'out', mode: 'value', schema: { type: 'region' } },
  ],
}
```

**Evaluate Node Definition:**

```ts
{
  id: 'evaluate',
  name: 'Evaluate',
  category: 'region',
  icon: 'Play',
  
  ports: [
    { id: 'region', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    // Dynamic ports generated from connected region's interface
  ],
}
```

**Evaluate Executor:**

```python
class EvaluateExecutor:
    node_type = "evaluate"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        region = regions['region']
        
        # Gather inputs matching the region's entry ports
        region_inputs = {
            port_id: inputs[port_id]
            for port_id in region.entry.output_ports
            if port_id in inputs
        }
        
        result = await runtime.execute_region(region, region_inputs)
        
        yield Result(outputs=result)
```

The Evaluate node's ports are dynamically generated to match the connected region's interface. When you connect a region, Evaluate gains input ports for each Entry output and output ports for each Exit input.

---

## Connection Rules

### Compatibility Matrix

| Source Mode | Target Mode | Valid | What Target Receives |
|-------------|-------------|-------|---------------------|
| value | value | ✓ | The data value |
| value | reference | ✓ | Handle to invoke source |
| value | structural | ✓ | Full region access |
| reference | value | ✗ | — |
| reference | reference | ✓ | The handle (passthrough) |
| reference | structural | ✓ | Full region access |
| structural | value | ✗ | — |
| structural | reference | ✓ | Handle to invoke region |
| structural | structural | ✓ | The region (passthrough) |

### Schema Compatibility

Schemas must be compatible for connection:

1. **Exact match**: `string` ↔ `string`
2. **Coercion**: `number` → `string` (built-in coercions)
3. **Any accepts all**: target `any` accepts any source
4. **Array wrapping**: single item → array (auto-wrapped)
5. **Namespace match**: `gmail:email` only matches `gmail:email`

### Visual Feedback

When dragging a connection, incompatible ports are dimmed. Compatible ports highlight. If multiple connection modes are possible, the system picks the most specific or prompts the user.

---

## Event System

Events are the universal communication mechanism in the node system. All node activity is expressed as events, and any node can subscribe to events from other nodes. This enables patterns like observability, supervision, and the built-in chat interface (which is itself just a node that subscribes to events and renders them).

### Event Structure

```ts
interface Event {
  id: string;
  type: string;
  source: {
    nodeId: NodeId;
    nodeType: string;    // e.g., 'agent', 'gmail', 'comfyui:KSampler'
  };
  timestamp: number;
  data: Record<string, any>;
}
```

The `source` includes both the node instance ID and the node type. This enables filtering by either specific instances or entire categories of nodes.

### Event Type Namespacing

Event types follow the same namespacing convention as node types and schemas:

**Core events** use simple names:
- `started`, `completed`, `error`, `cancelled`
- `progress`, `token`
- `tool_call_started`, `tool_call_completed`
- `approval_requested`, `approval_response`

**Custom events** use namespaced names:
- `gmail:rate_limited`
- `comfyui:queue_position`
- `slack:typing_indicator`
- `sethburkart123:custom_event`

The namespace should match the node type namespace. All events from ComfyUI nodes would use the `comfyui:` prefix, making it easy to subscribe to all ComfyUI-related activity.

### Standard Event Types

| Type | Description | Data |
|------|-------------|------|
| `started` | Node began executing | — |
| `progress` | Partial progress | `{ percent?, message?, partial? }` |
| `token` | Streaming token | `{ token }` |
| `tool_call_started` | Tool invocation began | `{ tool, args }` |
| `tool_call_completed` | Tool invocation finished | `{ tool, result, error? }` |
| `approval_requested` | Waiting for approval | `{ request_id, options }` |
| `approval_response` | Approval received | `{ request_id, approved, data? }` |
| `completed` | Node finished | `{ outputs }` |
| `error` | Node failed | `{ error, stack? }` |
| `cancelled` | Node was stopped | `{ reason? }` |

### Custom Events

Nodes can define and emit their own event types. Custom events should be namespaced to avoid collisions:

```python
# Gmail node emitting a custom rate limit event
yield Event(type='gmail:rate_limited', data={'retry_after': 60})

# ComfyUI node reporting queue position
yield Event(type='comfyui:queue_position', data={'position': 3, 'total': 10})

# Custom node from a third-party developer
yield Event(type='sethburkart123:analysis_stage', data={'stage': 'preprocessing'})
```

Nodes declare the custom events they emit in their definition:

```ts
events: {
  emits: ['started', 'completed', 'gmail:rate_limited', 'gmail:quota_warning'],
  accepts: ['stop', 'pause'],
}
```

### Event Filtering and Subscription

The runtime provides powerful filtering for event subscriptions. Filters can match on:

- **Node instance ID** — Events from a specific node
- **Node type** — Events from all nodes of a type (e.g., all `agent` nodes)
- **Node type pattern** — Events from nodes matching a pattern (e.g., all `comfyui:*` nodes)
- **Event type** — Specific event types
- **Event type pattern** — Event types matching a pattern (e.g., all `comfyui:*` events)
- **Combinations** — Any combination of the above

```python
# All events from a specific node instance
runtime.subscribe({'nodeId': 'node-123'})

# All events from any agent node
runtime.subscribe({'nodeType': 'agent'})

# All events from any ComfyUI node (pattern matching)
runtime.subscribe({'nodeType': 'comfyui:*'})

# All error events from anywhere
runtime.subscribe({'type': 'error'})

# All ComfyUI-namespaced events (regardless of which node emitted them)
runtime.subscribe({'type': 'comfyui:*'})

# All tool calls from agent nodes only
runtime.subscribe({'nodeType': 'agent', 'type': 'tool_call_started'})

# Complex: all errors OR all events from a specific node
runtime.subscribe({
  'or': [
    {'type': 'error'},
    {'nodeId': 'critical-node-456'}
  ]
})
```

### The Chat Start Node and Event Consumption

The built-in chat interface is implemented as a special node (Chat Start) that subscribes to events and renders them appropriately. It's not magic — it's just a node that:

1. Subscribes to relevant events (tokens, tool calls, completions, errors)
2. Transforms them into the chat UI format
3. Renders them in the message stream

This means custom nodes can emit events that the chat interface understands (using standard event types), or emit custom events that a custom UI subscribes to. The chat interface ignores events it doesn't recognize.

Other nodes can implement their own event consumption patterns:

```python
# An observability node that forwards all events
async def execute(self, config, inputs, refs, regions, runtime):
    async for event in runtime.subscribe({'type': '*'}):
        await self.forward_to_external_system(event)

# A supervisor that only watches for errors in agent nodes
async def execute(self, config, inputs, refs, regions, runtime):
    async for event in runtime.subscribe({'nodeType': 'agent', 'type': 'error'}):
        await self.handle_agent_error(event)

# A ComfyUI monitor that tracks all ComfyUI activity
async def execute(self, config, inputs, refs, regions, runtime):
    async for event in runtime.subscribe({'type': 'comfyui:*'}):
        self.update_comfyui_dashboard(event)
```

### Event Declaration in Node Definition

Nodes should declare their event interface:

```ts
{
  id: 'gmail',
  name: 'Gmail',
  // ...
  
  events: {
    // Events this node emits
    emits: [
      'started',
      'completed',
      'error',
      'gmail:rate_limited',
      'gmail:quota_warning',
      'gmail:message_sent',
    ],
    
    // Events this node can receive/react to
    accepts: [
      'stop',
      'pause',
      'gmail:force_refresh',  // Custom event another node might send
    ],
  },
}
```

This declaration serves multiple purposes:
- Documentation for users
- IDE autocomplete when subscribing
- Potential runtime validation (warn if emitting undeclared events)
- UI can show what events a node produces

---

## Custom UI

Nodes can provide custom React components for rendering and configuration.

### Custom Node Rendering

Override the default node appearance:

```ts
ui: {
  node: () => import('./MyCustomNode'),
}
```

The component receives node data, ports, and callbacks.

### Custom Configuration Panel

Replace the default property panel:

```ts
ui: {
  config: () => import('./MyConfigPanel'),
}
```

The component receives config values and a setter.

### Custom Control Types

Individual controls can have custom rendering:

```ts
controls: [
  {
    id: 'credentials',
    type: 'custom',
    ui: () => import('./OAuthControl'),
  },
]
```

### Foreign Node Rendering

For foreign subgraphs, the bridge provides node definitions that may include custom rendering:

```ts
// Provided by ComfyUI bridge
{
  id: 'comfyui:KSampler',
  name: 'KSampler',
  ui: {
    node: () => import('@comfyui-bridge/nodes/KSampler'),
  },
  // ...
}
```

---

## Implementation Considerations

### Persistence

For durable workflows:

- Serialize node state at event boundaries
- Store in database with workflow ID
- On resume, restore state and replay pending events
- External triggers route through a webhook/queue

### Security

Structural mode gives full graph access. Consider:

- Permission scoping (which nodes can be accessed)
- Sandboxing for foreign bridges
- Rate limiting for tool invocations
- Audit logging for all events

---

## Additional Example Scenarios

This section presents more complex real-world scenarios that users might want to build. Each demonstrates how the primitives compose to solve practical problems.

### Scenario: Integration Node with User-Defined Tools (Gmail, Slack, etc.)

A common pattern is an integration node that connects to an external service and exposes configurable tools for agents to use.

**Requirements:**
- User configurable settings (credentials, default behaviors) in a detailed config panel
- Text fields supporting JS expressions for dynamic values
- A "Tools" tab where users can enable/disable built-in tools
- Users can edit tool descriptions and parameters
- Users can create entirely new tools that combine operations with post-processing

**Implementation approach:**

The node has standard ports for direct execution, plus a tools output:

```ts
{
  id: 'gmail',
  name: 'Gmail',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'object' } },
    { id: 'output', direction: 'out', mode: 'value', schema: { type: 'object' } },
    { id: 'tools', direction: 'out', mode: 'value', schema: { type: 'array', items: { type: 'tool' } } },
  ],
  
  controls: [
    { id: 'credentials', type: 'custom', ui: () => import('./OAuthControl') },
    { id: 'operation', type: 'enum', options: ['send', 'search', 'archive', 'read'] },
    { id: 'query', type: 'string', expressions: true, placeholder: 'Search query...' },
  ],
  
  ui: {
    config: () => import('./GmailConfigPanel'),
    tools: () => import('./GmailToolsPanel'),
  },
}
```

The tools panel UI lets users:
- Toggle built-in tools on/off
- Edit tool names and descriptions
- Create new tools by specifying: name, description, which operation to run, parameter mappings, and optional JS post-processing

The executor builds tools dynamically from this configuration:

```python
class GmailExecutor:
    node_type = "gmail"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        # Direct execution mode
        if inputs.get('input'):
            result = await self.run_operation(config, inputs['input'])
            yield Result(outputs={'output': result})
            return
        
        # Tool provider mode
        tools = []
        for tool_config in config.get('enabled_tools', []):
            tools.append(self.build_tool(tool_config, config, runtime))
        
        yield Result(outputs={'tools': tools})
    
    def build_tool(self, tool_config, base_config, runtime):
        async def invoke(args):
            # Merge base config with tool presets and provided args
            merged = {**base_config, **tool_config.get('presets', {}), **args}
            result = await self.run_operation(merged, args)
            
            # Apply post-processing if defined
            if tool_config.get('postprocess'):
                result = self.apply_js_template(tool_config['postprocess'], result)
            
            return result
        
        return {
            'name': tool_config['name'],
            'description': tool_config['description'],
            'input_schema': tool_config['schema'],
            'invoke': invoke,
        }
```

When connected to an Agent's tools input (reference mode), the Agent receives these as callable handles.

### Scenario: Foreign System Wrapper (ComfyUI, n8n, etc.)

Embedding an entire external node system inside your graph, with full visual editing.

**Requirements:**
- Double-click to enter a subgraph editor
- User can customize which data comes in and goes out
- Nodes inside come from the foreign system's API with their native UI
- User can test-execute with sample inputs
- Results flow back to the parent graph

**Implementation approach:**

```ts
{
  id: 'comfyui-workflow',
  name: 'ComfyUI Workflow',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'object' } },
    { id: 'output', direction: 'out', mode: 'value', schema: { type: 'comfyui:image' } },
  ],
  
  controls: [
    { id: 'server', type: 'string', default: 'http://localhost:8188' },
  ],
  
  subgraph: {
    type: 'foreign',
    bridge: 'comfyui',
  },
}
```

The bridge is responsible for:

1. **Fetching node definitions** from ComfyUI's `/object_info` endpoint
2. **Translating to our format** including custom UI components for ComfyUI's widgets
3. **Handling execution** by converting the subgraph to ComfyUI's prompt format and queuing it
4. **Streaming events** back (queue position, progress, previews)

```python
class ComfyUIBridge:
    async def get_node_definitions(self, server_url):
        info = await fetch(f"{server_url}/object_info")
        return [self.translate_node(name, spec) for name, spec in info.items()]
    
    def translate_node(self, name, spec):
        return {
            'id': f'comfyui:{name}',
            'name': spec['display_name'],
            'ports': self.build_ports(spec['input'], spec['output']),
            'ui': {
                'node': lambda: self.build_widget_renderer(spec['input']),
            },
        }
    
    async def execute(self, graph, inputs, runtime):
        prompt = self.graph_to_prompt(graph, inputs)
        
        async for event in self.queue_and_stream(prompt):
            if event['type'] == 'progress':
                yield Event(type='comfyui:progress', data=event)
            elif event['type'] == 'preview':
                yield Event(type='comfyui:preview', data=event)
            elif event['type'] == 'complete':
                return event['outputs']
```

Inside the subgraph, Entry and Exit nodes define the interface. User connects ComfyUI nodes between them. The Entry outputs flow into ComfyUI's LoadImage or similar nodes, and final outputs connect to Exit.

### Scenario: Custom Execution Control (Loop, Parallel, Map, Reduce)

Nodes that change how their children execute rather than what they compute.

**Requirements:**
- Loop: run children once per item, sequentially
- Parallel: run children once per item, concurrently
- Map: transform each item through a region
- Reduce: aggregate items through a region
- These should compose (loop containing parallel, etc.)

**Implementation approach:**

All use structural mode to receive a region:

```ts
// Loop
{
  id: 'loop',
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    { id: 'results', direction: 'out', mode: 'value', schema: { type: 'array' } },
  ],
}

// Parallel
{
  id: 'parallel',
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    { id: 'results', direction: 'out', mode: 'value', schema: { type: 'array' } },
    { id: 'max_concurrent', direction: 'in', mode: 'value', schema: { type: 'number' } },
  ],
}
```

The key is that they delegate to `runtime.execute_region()` rather than reimplementing execution:

```python
class LoopExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        
        results = []
        for i, item in enumerate(items):
            yield Event(type='loop:iteration', data={'index': i, 'total': len(items)})
            
            result = await runtime.execute_region(body, {'item': item, 'index': i})
            results.append(result.get('output'))
        
        yield Result(outputs={'results': results})

class ParallelExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        max_concurrent = inputs.get('max_concurrent', 10)
        
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def run_one(item, index):
            async with semaphore:
                yield Event(type='parallel:started', data={'index': index})
                result = await runtime.execute_region(body, {'item': item, 'index': index})
                yield Event(type='parallel:completed', data={'index': index})
                return result
        
        results = await asyncio.gather(*[run_one(item, i) for i, item in enumerate(items)])
        yield Result(outputs={'results': [r.get('output') for r in results]})
```

Because execution goes through the runtime, nested structures work automatically. A loop body can contain a parallel node, which contains another loop, etc.

### Scenario: Workflow Supervisor

A node that monitors and intervenes in running workflows.

**Requirements:**
- Runs alongside the workflow, not in sequence
- Inspects running nodes: which are active, their progress, how long they've been running
- Can detect stuck nodes (idle too long)
- Can send events to nudge stuck nodes
- Can pause, resume, or stop nodes
- Uses an agent with tools to make intervention decisions

**Implementation approach:**

```ts
{
  id: 'workflow-supervisor',
  name: 'Workflow Supervisor',
  
  ports: [
    { id: 'watch', direction: 'in', mode: 'reference', schema: { type: 'any' }, multiple: true },
  ],
  
  controls: [
    { id: 'check_interval', type: 'number', default: 5000 },
    { id: 'idle_threshold', type: 'number', default: 30000 },
    { id: 'model', type: 'enum', options: ['gpt-4', 'claude-3'] },
    { id: 'instructions', type: 'text', default: 'Monitor workflow and intervene if nodes get stuck.' },
  ],
  
  events: {
    emits: ['supervisor:check', 'supervisor:intervention'],
    accepts: ['stop'],
  },
}
```

The executor runs an agent loop that can observe and control the runtime:

```python
class WorkflowSupervisorExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        interval = config['check_interval'] / 1000
        threshold = config['idle_threshold'] / 1000
        
        # Build supervisor tools
        tools = [
            self.build_inspect_tool(runtime),
            self.build_send_event_tool(runtime),
            self.build_pause_tool(runtime),
            self.build_resume_tool(runtime),
        ]
        
        agent = Agent(model=config['model'], instructions=config['instructions'], tools=tools)
        
        while True:
            # Check for stop signal
            async for event in runtime.subscribe({'nodeId': self.node_id, 'type': 'stop'}):
                return
            
            # Gather state
            processes = runtime.get_active_processes()
            stuck = [p for p in processes.values() if p.idle_time > threshold]
            
            if stuck:
                yield Event(type='supervisor:check', data={'stuck_count': len(stuck)})
                
                # Let the agent decide what to do
                response = await agent.run(f"These nodes appear stuck: {stuck}. Investigate and intervene if needed.")
                
                yield Event(type='supervisor:intervention', data={'action': response})
            
            await asyncio.sleep(interval)
    
    def build_send_event_tool(self, runtime):
        async def send_event(node_id: str, event_type: str, message: str):
            """Send an event to a running node to nudge it."""
            runtime.inject_event(node_id, Event(type=event_type, data={'message': message}))
            return {'sent': True}
        
        return Tool(name='send_event', fn=send_event)
```

The watched nodes need to handle incoming events:

```python
class AgentExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        # ... normal agent loop ...
        
        # Also listen for supervisor nudges
        async for event in runtime.subscribe({'nodeId': self.node_id, 'type': 'nudge'}):
            # Inject the nudge message into the conversation
            self.add_message({'role': 'system', 'content': event.data['message']})
```

### Scenario: Event Forwarder (Observability)

A passive node that watches all workflow activity and forwards it externally.

**Requirements:**
- No data flow participation (no ports affecting execution order)
- Subscribes to all events (or filtered subset)
- Forwards to external observability system
- Runs for lifetime of workflow

**Implementation approach:**

```ts
{
  id: 'event-forwarder',
  name: 'Event Forwarder',
  
  ports: [],  // No data ports
  
  controls: [
    { id: 'endpoint', type: 'string', placeholder: 'https://your-observability.com/ingest' },
    { id: 'filter', type: 'enum', options: ['all', 'errors', 'completions', 'tools'] },
    { id: 'include_data', type: 'boolean', default: true },
  ],
  
  events: {
    accepts: ['*'],
  },
}
```

```python
class EventForwarderExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        endpoint = config['endpoint']
        filter_type = config['filter']
        include_data = config['include_data']
        
        event_filter = self.build_filter(filter_type)
        
        async with aiohttp.ClientSession() as session:
            async for event in runtime.subscribe(event_filter):
                payload = {
                    'id': event.id,
                    'type': event.type,
                    'source': event.source,
                    'timestamp': event.timestamp,
                }
                if include_data:
                    payload['data'] = event.data
                
                try:
                    await session.post(endpoint, json=payload)
                except Exception as e:
                    yield Event(type='forwarder:error', data={'error': str(e)})
        
        yield Result(outputs={})
    
    def build_filter(self, filter_type):
        if filter_type == 'all':
            return {'type': '*'}
        elif filter_type == 'errors':
            return {'type': 'error'}
        elif filter_type == 'completions':
            return {'type': 'completed'}
        elif filter_type == 'tools':
            return {'or': [{'type': 'tool_call_started'}, {'type': 'tool_call_completed'}]}
```

Because it has no ports, it doesn't affect execution order. It simply runs and watches.

### Scenario: External Approval Gate

A node that pauses workflow execution waiting for external approval.

**Requirements:**
- Pauses execution at this point
- Sends approval request (email, Slack, webhook)
- Waits for response (could be hours or days)
- Routes to approved or rejected output
- State must survive server restarts

**Implementation approach:**

```ts
{
  id: 'approval-gate',
  name: 'Approval Gate',
  
  ports: [
    { id: 'input', direction: 'in', mode: 'value', schema: { type: 'any' } },
    { id: 'approved', direction: 'out', mode: 'value', schema: { type: 'any' } },
    { id: 'rejected', direction: 'out', mode: 'value', schema: { type: 'any' } },
  ],
  
  controls: [
    { id: 'channel', type: 'enum', options: ['email', 'slack', 'webhook'] },
    { id: 'recipients', type: 'string', placeholder: 'email@example.com' },
    { id: 'message', type: 'text', expressions: true },
    { id: 'timeout_hours', type: 'number', default: 24 },
  ],
  
  events: {
    emits: ['approval:requested', 'approval:received', 'approval:timeout'],
    accepts: ['approval:response'],
  },
}
```

```python
class ApprovalGateExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        data = inputs['input']
        request_id = generate_unique_id()
        timeout = config['timeout_hours'] * 3600
        
        # Send the approval request
        await self.send_request(
            channel=config['channel'],
            recipients=config['recipients'],
            message=config['message'],
            request_id=request_id,
            callback_url=runtime.get_callback_url(request_id),
        )
        
        yield Event(type='approval:requested', data={'request_id': request_id})
        
        # Wait for response
        try:
            async for event in runtime.subscribe(
                {'type': 'approval:response', 'data.request_id': request_id},
                timeout=timeout
            ):
                yield Event(type='approval:received', data=event.data)
                
                if event.data.get('approved'):
                    yield Result(outputs={'approved': data})
                else:
                    yield Result(outputs={'rejected': data})
                return
        
        except TimeoutError:
            yield Event(type='approval:timeout', data={'request_id': request_id})
            yield Result(outputs={'rejected': data})
```

The runtime handles persistence. When the approval email is clicked, it hits a callback URL that the runtime routes to `approval:response` event. The runtime rehydrates the paused execution and delivers the event.

---

## Summary

The node system v2 is built on five primitives:

| Primitive | Purpose |
|-----------|---------|
| **Event Processes** | Nodes have lifecycle, state, and bidirectional event flow |
| **Ports** | Typed connections with mode (value/reference/structural) |
| **Schemas** | Namespaced types for compatibility checking |
| **Regions** | Bounded subgraphs with Entry/Exit, invocable as units |
| **Runtime** | Executes regions, routes events, observable and controllable |

These primitives compose to express:

- Simple data transforms (value mode)
- Tool consumption and provision (reference mode)
- Custom execution control: loops, parallel, conditional (structural mode)
- Foreign system integration (bridges)
- Long-running workflows (durable execution)
- Supervision and debugging (runtime observation)
- Visual debugging (closure zones)

No special cases. No hardcoded patterns. Just five primitives and their composition.
