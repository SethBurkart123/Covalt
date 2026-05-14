# Events

Events are the universal communication mechanism in the node system. All node activity is expressed as events, and any node can subscribe to events from other nodes.

## Nodes as Event Processes

A node is not a pure function that transforms inputs to outputs. A node is a stateful process that runs over time, emits events, and can respond to external signals.

### When Nodes Start

Most nodes are **triggered** — they wait for their inputs to be satisfied, then run. This is the default.

Some nodes are **ambient** — they start when the workflow starts and run continuously. Observers, supervisors, and external queue processors are typically ambient. Mark them with `ambient: true` in the definition.

### During Execution

When a node executes, it enters a running state. During execution it may:
- Emit progress events
- Request approvals
- Stream partial results
- Report state changes

It can also receive events from outside:
- Stop signals
- Pause requests
- Injected data from supervisors
- Responses to approval requests

### Emitting Outputs

When a node yields a `Result`, it controls what happens next:
- **Continue** (default for ambient): emit outputs, keep running, downstream executes in parallel
- **Await downstream**: pause until all triggered downstream nodes complete, receive their results
- **Stop**: emit outputs and terminate

This is imperative — the executor decides based on the current situation. See [Runtime](./runtime.md) for details.

### Termination

Eventually the node completes (emitting final outputs with `stop=True`) or is terminated by the runtime. Ambient nodes typically run until the workflow completes, at which point they receive a `workflow:completed` event.

This model accommodates both simple transform nodes (which emit once and stop immediately) and long-running processes (like an agent that may run for minutes, pausing for tool calls and approvals, or a supervisor that runs for the entire workflow lifetime).

## Event Structure

```ts
interface Event {
  id: string;
  type: string;
  source: {
    nodeId: NodeId;
    nodeType: string;
  };
  timestamp: number;
  data: Record<string, any>;
}
```

The `source` includes both the node instance ID and the node type. This enables filtering by either specific instances or entire categories of nodes.

## Event Type Namespacing

Event types follow the same namespacing convention as node types and schemas.

**Core events** use simple names:
- `started`, `completed`, `error`, `cancelled`
- `progress`, `token`
- `tool_call_started`, `tool_call_completed`
- `approval_requested`, `approval_response`

**Custom events** use namespaced names:
- `gmail:rate_limited`
- `comfyui:queue_position`
- `slack:typing_indicator`

The namespace should match the node type namespace. All events from ComfyUI nodes would use the `comfyui:` prefix.

## Standard Event Types

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

## Emitting Events

Executors emit events by yielding them:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    yield Event(type='started')
    
    for i, item in enumerate(items):
        yield Event(type='progress', data={'percent': i / len(items)})
        # process item...
    
    yield Event(type='gmail:sync_complete', data={'count': len(items)})
    yield Result(outputs={'result': processed})
```

Custom events should be namespaced:

```python
yield Event(type='gmail:rate_limited', data={'retry_after': 60})
yield Event(type='comfyui:queue_position', data={'position': 3, 'total': 10})
```

## Subscribing to Events

Nodes subscribe to events through the runtime:

```python
async for event in runtime.subscribe({'type': 'error'}):
    # handle error events from anywhere
```

### Event Filters

```ts
interface EventFilter {
  nodeId?: NodeId;              // Specific node instance
  nodeType?: string;            // Node type, supports wildcards
  type?: string;                // Event type, supports wildcards
  or?: EventFilter[];           // Match any of these filters
  and?: EventFilter[];          // Match all of these filters
}
```

Filters support wildcards (`*`) for pattern matching.

### Filter Examples

```python
# All events from a specific node instance
runtime.subscribe({'nodeId': 'node-123'})

# All events from any agent node
runtime.subscribe({'nodeType': 'agent'})

# All events from any ComfyUI node
runtime.subscribe({'nodeType': 'comfyui:*'})

# All error events from anywhere
runtime.subscribe({'type': 'error'})

# All ComfyUI-namespaced events
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

## Event Declaration

Nodes declare the events they emit and accept in their definition:

```ts
{
  id: 'gmail',
  name: 'Gmail',
  
  events: {
    emits: [
      'started',
      'completed',
      'error',
      'gmail:rate_limited',
      'gmail:quota_warning',
      'gmail:message_sent',
    ],
    accepts: [
      'stop',
      'pause',
      'gmail:force_refresh',
    ],
  },
}
```

This declaration serves multiple purposes:
- Documentation for users
- IDE autocomplete when subscribing
- Potential runtime validation
- UI can show what events a node produces

## The Chat Interface Pattern

The built-in chat interface is implemented as a node (Chat Start) that subscribes to events and renders them. It's not magic — it's just a node that:

1. Subscribes to relevant events (tokens, tool calls, completions, errors)
2. Transforms them into the chat UI format
3. Renders them in the message stream

This means custom nodes can:
- Emit events the chat interface understands (using standard event types)
- Emit custom events that a custom UI subscribes to

The chat interface ignores events it doesn't recognize.

## Receiving Events Mid-Execution

Nodes can react to events while running:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    # Start some work
    task = asyncio.create_task(self.do_work())
    
    # Listen for stop signals
    async for event in runtime.subscribe({'nodeId': self.node_id, 'type': 'stop'}):
        task.cancel()
        yield Event(type='cancelled')
        return
    
    result = await task
    yield Result(outputs={'result': result})
```

Or handling approval responses:

```python
async def execute(self, config, inputs, refs, regions, runtime):
    request_id = generate_id()
    yield Event(type='approval_requested', data={'request_id': request_id})
    
    async for event in runtime.subscribe({
        'type': 'approval_response',
        'data.request_id': request_id
    }):
        if event.data['approved']:
            # continue with approved action
            yield Result(outputs={'approved': True})
        else:
            yield Result(outputs={'approved': False})
        return
```

## Event Injection

External systems or supervisor nodes can inject events:

```python
# Supervisor injecting a nudge
runtime.inject_event(node_id, Event(
    type='nudge',
    data={'message': 'You appear stuck. Please continue.'}
))
```

The target node receives this through its event subscription.

## Example: Observability Node

A passive node that watches all events:

```python
class ObservabilityExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        endpoint = config['endpoint']
        
        async for event in runtime.subscribe({'type': '*'}):
            await self.forward_event(endpoint, event)
        
        yield Result(outputs={})
```

This node has no ports — it doesn't participate in data flow. It simply subscribes to events and forwards them.

## Example: Supervisor Node

A node that monitors and intervenes:

```python
class SupervisorExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        threshold = config['idle_threshold']
        
        while True:
            processes = runtime.get_active_processes()
            
            for node_id, state in processes.items():
                if state.idle_time > threshold:
                    runtime.inject_event(node_id, Event(
                        type='nudge',
                        data={'message': 'Continue with your task.'}
                    ))
            
            await asyncio.sleep(config['check_interval'])
```

The supervisor uses runtime observation to find stuck nodes and event injection to nudge them.
