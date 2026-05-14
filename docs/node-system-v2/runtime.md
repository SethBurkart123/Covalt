# Runtime

The runtime is the execution environment. It schedules nodes, routes events, and provides observation and control capabilities.

## Runtime Interface

```ts
interface Runtime {
  // Region execution
  execute_region(region: Region, inputs: Record<string, any>): Promise<Record<string, any>>;
  execute_foreign(bridge: string, graph: any, inputs: Record<string, any>): Promise<any>;
  
  // Events
  emit(event: Event): void;
  subscribe(filter: EventFilter): AsyncIterator<Event>;
  inject_event(nodeId: NodeId, event: Event): void;
  
  // Observation
  get_active_processes(): Map<NodeId, ProcessState>;
  get_state(nodeId: NodeId): ProcessState;
  on_state_change(nodeId: NodeId, handler: StateHandler): Unsubscribe;
  
  // Control
  pause(nodeId: NodeId): void;
  resume(nodeId: NodeId): void;
  stop(nodeId: NodeId): void;
  
  // Graph queries
  get_node(nodeId: NodeId): NodeData;
  get_definition(nodeType: string): NodeDefinition;
  
  // Methods
  invoke_method(nodeId: NodeId, method: string, params: Record<string, any>): Promise<any>;
}
```

## Node Lifecycle

Before diving into execution mechanics, it's important to understand when nodes start running.

### Triggered vs Ambient Nodes

Most nodes are **triggered** — they wait for their inputs to be ready, then run. This is the default behavior and requires no special declaration.

Some nodes need to run for the entire workflow lifetime, watching events or supervising other nodes. These are **ambient** nodes. They start when the workflow starts and run alongside everything else.

```ts
{
  id: 'event-forwarder',
  ambient: true,  // starts with workflow, not when inputs ready
  ports: [],
}
```

When a workflow begins, the runtime:
1. Starts all `ambient: true` nodes immediately
2. Begins normal triggered execution for everything else
3. When the workflow completes, handles ambient node termination based on their subscription config

Ambient nodes don't need connected inputs to run. They exist to observe, supervise, or react to external events.

### Event Subscriptions

Ambient nodes typically need to receive events. Rather than polling, declare what events to receive:

```ts
{
  id: 'event-forwarder',
  ambient: true,
  
  subscription: {
    filter: {'type': '*'},              // which events to receive
    replay: true,                        // backfill events from workflow start
    onWorkflowComplete: 'finish',        // how to handle workflow completion
  },
}
```

**filter**: Event filter (same syntax as `runtime.subscribe()`). Only matching events are delivered.

**replay**: If true, buffer events from workflow start until the node is ready. The node receives all events it would have missed during startup. Default: false.

**onWorkflowComplete**: What happens when the workflow completes:
- `'terminate'` — Kill immediately, no cleanup (default)
- `'finish'` — Stop delivering events, let the executor finish naturally
- `'grace:5000'` — Wait up to 5000ms for node to stop, then kill
- `'ignore'` — Node keeps running until it stops itself (dangerous, can hang workflow)

In the executor, events arrive through `runtime.events()`:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    batch = []
    
    async for event in runtime.events():
        batch.append(event)
        if len(batch) >= 100:
            await self.flush(batch)
            batch = []
    
    # Loop exits based on onWorkflowComplete setting
    # With 'finish': we get here to clean up
    if batch:
        await self.flush(batch)
    
    yield Result(outputs={}, stop=True)
```

For nodes without a `subscription` declaration, `runtime.events()` yields nothing. They can still use `runtime.subscribe()` imperatively for dynamic subscriptions.

### Emission Behavior

When a node yields a `Result`, what happens next? For simple transform nodes, the answer is obvious: emit outputs, done. But nodes that run continuously need more control.

The `Result` object accepts options that control post-emission behavior:

```python
# Default: emit outputs and terminate
yield Result(outputs={'value': x})

# Emit outputs but keep running (fire and forget)
yield Result(outputs={'item': item})
# execution continues here immediately, downstream runs in parallel

# Emit outputs, wait for downstream to complete, then continue
downstream = yield Result(outputs={'item': item}, await_downstream=True)
# execution pauses until all triggered downstream nodes complete
# downstream = {'node_id': {'output_port': value, ...}, ...}

# Emit outputs and explicitly terminate
yield Result(outputs={'final': value}, stop=True)
```

This is purely imperative — the node controls its own lifecycle through what it yields. There's no declarative configuration because different situations within the same node might need different behaviors.

### Why Imperative?

Consider a queue processor that should wait for each item to be fully processed before acknowledging it:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    async for item in self.watch_queue():
        # Process through downstream, wait for completion
        results = yield Result(outputs={'item': item}, await_downstream=True)
        
        # Check downstream success before acknowledging
        if results.get('processor', {}).get('success'):
            await self.ack(item)
        else:
            await self.nack(item)
```

Or a supervisor that emits nudges without waiting:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    while True:
        for node_id, state in runtime.get_active_processes().items():
            if state.idle_time > threshold:
                # Emit nudge, don't wait, keep monitoring
                yield Result(outputs={'nudged': node_id})
        
        await asyncio.sleep(interval)
```

The same node type might even mix behaviors based on conditions:

```python
if urgent:
    yield Result(outputs={'alert': data})  # fire and forget
else:
    results = yield Result(outputs={'item': data}, await_downstream=True)  # wait
```

Declarative configuration can't express this. Imperative control can.

## Execution

The runtime's primary job is executing graphs.

### Value-Mode Execution

For simple value-mode connections, the runtime runs nodes in topological order. It:
1. Identifies nodes with no unsatisfied dependencies
2. Runs them, collecting outputs
3. Delivers outputs to connected inputs
4. Repeats until all nodes complete

### Structural-Mode Execution

When a node has structural connections, the runtime skips the owned regions in its normal pass. The owning node handles them via `execute_region`.

```python
# Loop node executing its body region
for item in items:
    result = await runtime.execute_region(regions['body'], {'item': item})
    results.append(result)
```

The runtime:
1. Injects inputs through the entry node
2. Runs all internal nodes in order
3. Collects outputs from the exit node
4. Returns them

### Foreign Execution

Foreign subgraphs delegate to bridges:

```python
result = await runtime.execute_foreign(
    bridge='comfyui',
    graph=subgraph_data,
    inputs={'image': input_image}
)
```

The bridge translates to the foreign system's execution model and streams events back.

## Events

The runtime is an event bus.

### Event Filter

```ts
interface EventFilter {
  nodeId?: NodeId;
  nodeType?: string;
  type?: string;
  or?: EventFilter[];
  and?: EventFilter[];
}
```

Wildcards (`*`) are supported for pattern matching:
- `nodeType: 'comfyui:*'` — all ComfyUI node types
- `type: 'comfyui:*'` — all ComfyUI event types

### Subscribing

```python
async for event in runtime.subscribe({'type': 'error'}):
    handle_error(event)
```

Subscriptions are async iterators. They yield events matching the filter until the workflow completes or the subscription is cancelled.

### Emitting

Executors emit events by yielding them:

```python
yield Event(type='progress', data={'percent': 0.5})
```

The runtime routes emitted events to all matching subscribers.

### Injecting

External systems or supervisor nodes can inject events into running nodes:

```python
runtime.inject_event(node_id, Event(type='stop'))
```

The target node receives the event through its subscription.

## Observation

The runtime tracks all active node processes.

### Process State

```ts
interface ProcessState {
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error';
  progress?: number;
  message?: string;
  started_at: number;
  idle_time: number;
  custom: Record<string, any>;
}
```

### Querying State

```python
# Get all running processes
processes = runtime.get_active_processes()

# Get specific node state
state = runtime.get_state('node-123')
if state.idle_time > threshold:
    # node might be stuck
```

### State Change Subscription

```python
unsubscribe = runtime.on_state_change('node-123', lambda state: 
    print(f"Node state: {state.status}")
)
```

## Control

The runtime provides control operations for running nodes.

### Pause and Resume

```python
runtime.pause('node-123')
# ... later ...
runtime.resume('node-123')
```

Pausing suspends execution. The node retains its state and can resume.

### Stop

```python
runtime.stop('node-123')
```

Stopping terminates execution. The node cannot resume.

### Event-Based Control

Prefer injecting events over direct control when the node should decide how to respond:

```python
# Instead of runtime.stop(), inject a stop event
runtime.inject_event('node-123', Event(type='stop'))
```

The node can then clean up gracefully.

## Graph Queries

### Getting Nodes

```python
node = runtime.get_node('node-123')
# node = { 'id': 'node-123', 'type': 'agent', 'data': {...} }
```

### Getting Definitions

```python
definition = runtime.get_definition('agent')
# definition = NodeDefinition with ports, controls, etc.
```

## Methods

Nodes can expose methods that other nodes or external systems can call.

### Invoking Methods

```python
options = await runtime.invoke_method('agent-1', 'listModels', {'provider': 'openai'})
```

This calls the `listModels` method on the agent node and returns the result.

### Method Implementation

Methods are implemented on the executor:

```python
class AgentExecutor:
    node_type = "agent"
    
    async def listModels(self, params, context):
        provider = params.get('provider')
        return await get_available_models(provider)
    
    async def execute(self, config, inputs, refs, regions, runtime):
        # normal execution
```

Methods are separate from the main `execute` — they're utility functions that don't run the node's primary logic.

## Persistence

For durable workflows that survive restarts:

### Serialization

The runtime can serialize workflow state at event boundaries:
- Which nodes have completed
- Current outputs
- Pending events

### Restoration

On restart, the runtime:
1. Loads persisted state
2. Restores completed outputs
3. Resumes pending nodes

### External Triggers

External events (approval responses, webhooks) route through the runtime:

```python
# External system calling into the runtime
runtime.inject_event('approval-gate-1', Event(
    type='approval_response',
    data={'request_id': 'req-123', 'approved': True}
))
```

The runtime rehydrates the paused node and delivers the event.

## Executor Signature

The full executor signature with runtime access:

```python
class NodeExecutor:
    node_type: str = "my-node"
    
    async def execute(
        self,
        config: dict,
        inputs: dict,
        refs: dict,
        regions: dict,
        runtime: Runtime,
    ) -> AsyncIterator[Event | Result]:
        # Access runtime for:
        # - Executing regions
        # - Subscribing to events
        # - Observing processes
        # - Invoking methods
        yield Result(outputs={'output': value})
```

## Result Options

The `Result` object controls what happens after emission:

```python
@dataclass
class Result:
    outputs: dict
    await_downstream: bool = False  # pause until downstream completes
    stop: bool = False              # terminate after this emit
```

### Default Behavior

By default, yielding a `Result` emits outputs to downstream nodes and terminates the executor. This is the behavior for simple transform nodes:

```python
yield Result(outputs={'uppercase': text.upper()})
# node terminates here
```

### Fire and Forget

For nodes that emit multiple times, just yield without `stop`:

```python
for item in items:
    yield Result(outputs={'item': item})
    # continues immediately, downstream runs in parallel
yield Result(outputs={}, stop=True)  # done
```

Each `Result` triggers downstream execution. The node keeps running. Downstream executions happen in parallel with continued node execution.

### Await Downstream

When you need to know that downstream completed (or need their results):

```python
downstream = yield Result(outputs={'item': item}, await_downstream=True)
# execution pauses here
# downstream = {
#   'processor-1': {'result': 'processed', 'success': True},
#   'logger-2': {'logged': True},
# }
```

The runtime collects outputs from all nodes that were triggered by this emission and returns them keyed by node ID.

### Explicit Stop

Use `stop=True` to terminate even if the executor could continue:

```python
if error_condition:
    yield Result(outputs={'error': msg}, stop=True)
    # executor terminates, code below never runs

# normal path continues...
```

## Example: Parallel Execution

Using runtime to execute regions concurrently:

```python
class ParallelExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        max_concurrent = config.get('max_concurrent', 10)
        
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def run_one(item, index):
            async with semaphore:
                return await runtime.execute_region(body, {'item': item, 'index': index})
        
        results = await asyncio.gather(*[run_one(item, i) for i, item in enumerate(items)])
        yield Result(outputs={'results': [r.get('output') for r in results]})
```

## Example: Supervisor with Runtime Access

Full supervisor using observation, events, and control:

```python
class SupervisorExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        while True:
            # Check for stop signal
            try:
                async for event in runtime.subscribe({'nodeId': self.node_id, 'type': 'stop'}):
                    return
            except asyncio.TimeoutError:
                pass
            
            # Observe running processes
            for node_id, state in runtime.get_active_processes().items():
                if state.idle_time > config['threshold']:
                    # Inject nudge event
                    runtime.inject_event(node_id, Event(
                        type='nudge',
                        data={'message': 'Continue with your task.'}
                    ))
            
            await asyncio.sleep(config['interval'])
```
