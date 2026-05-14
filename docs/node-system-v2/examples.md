# Examples

This document presents complete implementations of common node patterns. Each example demonstrates how the primitives compose to solve practical problems.

## Simple Transform Node

A basic node that transforms text to uppercase.

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

```python
class UppercaseExecutor:
    node_type = "uppercase"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        text = inputs['text']
        yield Result(outputs={'result': text.upper()})
```

This is the simplest possible node. Value in, value out, no events, no references.

## LLM Completion with Streaming

A node that calls an LLM and streams the response.

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
    { id: 'model', type: 'enum', options: { method: 'listModels' } },
    { id: 'temperature', type: 'number', default: 0.7, min: 0, max: 2 },
  ],
  
  methods: {
    listModels: { params: {}, returns: { type: 'array' } },
  },
  
  events: {
    emits: ['started', 'token', 'completed', 'error'],
  },
}
```

```python
class LLMCompletionExecutor:
    node_type = "llm-completion"
    
    async def listModels(self, params, context):
        return [
            {'value': 'gpt-4', 'label': 'GPT-4', 'group': 'OpenAI'},
            {'value': 'claude-3', 'label': 'Claude 3', 'group': 'Anthropic'},
        ]
    
    async def execute(self, config, inputs, refs, regions, runtime):
        prompt = inputs['prompt']
        model = get_model(config['model'])
        
        yield Event(type='started')
        
        full_response = ""
        async for token in model.stream(prompt, temperature=config['temperature']):
            full_response += token
            yield Event(type='token', data={'token': token})
        
        yield Result(outputs={'response': full_response})
```

Demonstrates event streaming for real-time display.

## Agent Consuming Tools

An agent that uses tools based on LLM decisions.

```ts
{
  id: 'agent',
  name: 'Agent',
  category: 'ai',
  icon: 'Bot',
  
  ports: [
    { id: 'message', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'tool' }, multiple: true },
    { id: 'response', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
  
  controls: [
    { id: 'model', type: 'enum', options: { method: 'listModels' } },
    { id: 'instructions', type: 'text', placeholder: 'System prompt' },
  ],
  
  events: {
    emits: ['started', 'tool_call_started', 'tool_call_completed', 'token', 'completed'],
    accepts: ['stop'],
  },
}
```

```python
class AgentExecutor:
    node_type = "agent"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        message = inputs['message']
        tools = refs.get('tools', [])
        
        llm_tools = [
            {'name': t.name, 'description': t.description, 'parameters': t.input_schema}
            for t in tools
        ]
        
        model = get_model(config['model'])
        messages = [
            {'role': 'system', 'content': config['instructions']},
            {'role': 'user', 'content': message},
        ]
        
        yield Event(type='started')
        
        while True:
            response = await model.chat(messages, tools=llm_tools)
            
            if response.tool_calls:
                for call in response.tool_calls:
                    yield Event(type='tool_call_started', data={'tool': call.name, 'args': call.args})
                    
                    tool = next(t for t in tools if t.name == call.name)
                    result = await tool.invoke(call.args)
                    
                    yield Event(type='tool_call_completed', data={'tool': call.name, 'result': result})
                    messages.append({'role': 'tool', 'content': result, 'tool_call_id': call.id})
            else:
                yield Result(outputs={'response': response.content})
                return
```

Tools are received as reference-mode handles and invoked on demand.

## Integration with User-Configurable Tools (Gmail)

A node that provides configurable tools for external services.

```ts
{
  id: 'gmail',
  name: 'Gmail',
  category: 'integration',
  icon: 'Mail',
  
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
    tools: () => import('./GmailToolsPanel'),
  },
}
```

```python
class GmailExecutor:
    node_type = "gmail"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        if inputs.get('input'):
            result = await self.run_operation(config, inputs['input'])
            yield Result(outputs={'output': result})
            return
        
        tools = []
        for tool_config in config.get('enabled_tools', []):
            tools.append(self.build_tool(tool_config, config, runtime))
        
        yield Result(outputs={'tools': tools})
    
    def build_tool(self, tool_config, base_config, runtime):
        async def invoke(args):
            merged = {**base_config, **tool_config.get('presets', {}), **args}
            result = await self.run_operation(merged, args)
            
            if tool_config.get('postprocess'):
                result = self.apply_js_template(tool_config['postprocess'], result)
            
            return result
        
        return {
            'name': tool_config['name'],
            'description': tool_config['description'],
            'input_schema': tool_config['schema'],
            'invoke': invoke,
        }
    
    async def run_operation(self, config, input_data):
        operation = config['operation']
        if operation == 'search':
            return await self.search_emails(config['query'])
        elif operation == 'send':
            return await self.send_email(input_data)
        # ... other operations
```

The tools panel UI lets users enable/disable built-in tools, edit descriptions, and create new tools with preset configurations.

## Loop Node

A node that executes a region repeatedly for each item.

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
  
  events: {
    emits: ['loop:iteration_started', 'loop:iteration_completed'],
  },
}
```

```python
class LoopExecutor:
    node_type = "loop"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        
        results = []
        for i, item in enumerate(items):
            yield Event(type='loop:iteration_started', data={'index': i, 'total': len(items)})
            
            result = await runtime.execute_region(body, {'item': item, 'index': i})
            results.append(result.get('output'))
            
            yield Event(type='loop:iteration_completed', data={'index': i})
        
        yield Result(outputs={'results': results})
```

The loop delegates to `runtime.execute_region`, so nested structures work correctly.

## Parallel Execution Node

Run a region concurrently for all items.

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
                return await runtime.execute_region(body, {'item': item, 'index': index})
        
        results = await asyncio.gather(*[run_one(item, i) for i, item in enumerate(items)])
        yield Result(outputs={'results': [r.get('output') for r in results]})
```

## ComfyUI Wrapper

A foreign subgraph that embeds ComfyUI workflows.

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

```python
class ComfyUIWorkflowExecutor:
    node_type = "comfyui-workflow"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        subgraph = self.get_subgraph()
        
        yield Event(type='comfyui:sending')
        
        result = await runtime.execute_foreign(
            bridge='comfyui',
            graph=subgraph,
            inputs=inputs['input'],
        )
        
        yield Result(outputs={'output': result})
```

The bridge handles translation to ComfyUI's API.

## Workflow Supervisor

A node that monitors and intervenes in running workflows. This is an ambient node — it starts when the workflow starts and runs continuously alongside normal execution.

```ts
{
  id: 'workflow-supervisor',
  name: 'Workflow Supervisor',
  category: 'debug',
  icon: 'Eye',
  
  ambient: true,
  
  subscription: {
    filter: {'type': 'completed'},     // watch for node completions
    onWorkflowComplete: 'terminate',   // nothing to clean up
  },
  
  ports: [
    { id: 'watch', direction: 'in', mode: 'reference', schema: { type: 'any' }, multiple: true },
    { id: 'nudged', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
  
  controls: [
    { id: 'idle_threshold', type: 'number', default: 30000 },
  ],
  
  events: {
    emits: ['supervisor:intervention'],
  },
}
```

```python
class WorkflowSupervisorExecutor:
    node_type = "workflow-supervisor"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        threshold = config['idle_threshold'] / 1000
        
        # Events delivered based on subscription — no polling needed
        async for event in runtime.events():
            # On each completion event, check all processes for stuck nodes
            for node_id, state in runtime.get_active_processes().items():
                if state.idle_time > threshold:
                    yield Event(type='supervisor:intervention', data={'target': node_id})
                    
                    # Emit nudge notification — fire and forget
                    yield Result(outputs={'nudged': node_id})
                    
                    runtime.inject_event(node_id, Event(
                        type='nudge',
                        data={'message': 'You appear stuck. Please continue.'}
                    ))
        
        yield Result(outputs={}, stop=True)
```

The supervisor listens for completion events as triggers to check for stuck nodes. Each completion is an opportunity to scan. The `onWorkflowComplete: 'terminate'` means no cleanup is needed — the runtime kills it immediately when the workflow ends.

## Event Forwarder (Observability)

A passive node that watches all events and forwards them to an external endpoint. This is an ambient node with no ports — it exists purely to observe.

```ts
{
  id: 'event-forwarder',
  name: 'Event Forwarder',
  category: 'debug',
  icon: 'Activity',
  
  ambient: true,
  
  subscription: {
    filter: {'type': '*'},          // receive all events
    replay: true,                    // don't miss events during startup
    onWorkflowComplete: 'finish',    // let us flush before terminating
  },
  
  ports: [],
  
  controls: [
    { id: 'endpoint', type: 'string', placeholder: 'https://...' },
    { id: 'batch_size', type: 'number', default: 50 },
  ],
}
```

```python
class EventForwarderExecutor:
    node_type = "event-forwarder"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        endpoint = config['endpoint']
        batch_size = config.get('batch_size', 50)
        batch = []
        
        async with aiohttp.ClientSession() as session:
            # Events delivered based on subscription.filter
            # Loop exits when workflow completes (onWorkflowComplete: 'finish')
            async for event in runtime.events():
                batch.append({
                    'id': event.id,
                    'type': event.type,
                    'source': event.source,
                    'data': event.data,
                })
                
                if len(batch) >= batch_size:
                    await session.post(endpoint, json=batch)
                    batch = []
            
            # Flush remaining events after workflow completes
            if batch:
                await session.post(endpoint, json=batch)
        
        yield Result(outputs={}, stop=True)
```

The subscription declaration handles the complexity:
- `filter` determines which events arrive
- `replay: true` ensures no events are missed during node startup
- `onWorkflowComplete: 'finish'` stops the event loop but lets the executor flush remaining data

The executor is just straightforward batch processing.

## External Approval Gate

A node that pauses for external approval.

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
    { id: 'channel', type: 'enum', options: ['email', 'slack', 'webhook'] },
    { id: 'recipients', type: 'string' },
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
    node_type = "approval-gate"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        data = inputs['input']
        request_id = generate_unique_id()
        timeout = config['timeout_hours'] * 3600
        
        await self.send_request(
            channel=config['channel'],
            recipients=config['recipients'],
            message=config['message'],
            request_id=request_id,
        )
        
        yield Event(type='approval:requested', data={'request_id': request_id})
        
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
            yield Event(type='approval:timeout')
            yield Result(outputs={'rejected': data})
```

Waits for external event, persists across restarts.

## Conditional Router

Route data based on conditions.

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
    
    def evaluate(self, field_value, operator, compare_value):
        if operator == 'equals':
            return field_value == compare_value
        elif operator == 'contains':
            return compare_value in str(field_value)
        elif operator == 'greater_than':
            return float(field_value) > float(compare_value)
        elif operator == 'exists':
            return field_value is not None
        return False
```

Only one output port receives data based on the condition.

## Variable Forwarding Node

Forwards control definitions from another node to triggers.

```ts
{
  id: 'agent-variables',
  name: 'Agent Variables',
  category: 'utility',
  icon: 'Settings',
  
  ports: [
    { id: 'definitions', direction: 'out', mode: 'value', 
      schema: { type: 'array', items: { type: 'core:control-definition' } } },
  ],
  
  controls: [
    { id: 'source', type: 'node-ref', nodeTypes: ['agent'] },
    { id: 'include', type: 'array', items: { type: 'string' } },
  ],
}
```

```python
class AgentVariablesExecutor:
    node_type = "agent-variables"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        source_id = config['source']
        include = set(config.get('include', []))
        
        source_node = runtime.get_node(source_id)
        definition = runtime.get_definition(source_node['type'])
        
        controls = []
        for control in definition.controls:
            if include and control.id not in include:
                continue
            
            ctrl = {
                'id': control.id,
                'type': control.type,
                'label': control.label,
                'default': source_node['data'].get(control.id, control.default),
            }
            
            if control.options and control.options.get('method'):
                ctrl['options'] = {
                    'nodeId': source_id,
                    'method': control.options['method'],
                }
            elif control.options:
                ctrl['options'] = control.options
            
            controls.append(ctrl)
        
        yield Result(outputs={'definitions': controls})
```

Enables triggers to render controls from downstream nodes without auto-discovery magic.

## Gated Queue Processor

An ambient node that watches an external queue and processes items through downstream nodes, waiting for each to complete before acknowledging.

```ts
{
  id: 'queue-processor',
  name: 'Queue Processor',
  category: 'integration',
  icon: 'Inbox',
  
  ambient: true,
  
  subscription: {
    onWorkflowComplete: 'grace:10000',  // allow 10s to finish current item
  },
  
  ports: [
    { id: 'item', direction: 'out', mode: 'value', schema: { type: 'object' } },
  ],
  
  controls: [
    { id: 'queue_url', type: 'string' },
  ],
  
  events: {
    emits: ['queue:item_received', 'queue:item_acked', 'queue:item_nacked'],
  },
}
```

```python
class QueueProcessorExecutor:
    node_type = "queue-processor"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        queue = connect_queue(config['queue_url'])
        
        async for item in queue.consume():
            yield Event(type='queue:item_received', data={'id': item.id})
            
            # Emit item and WAIT for downstream to complete
            downstream_results = yield Result(
                outputs={'item': item.data},
                await_downstream=True
            )
            
            # Check if downstream succeeded
            # downstream_results = {'processor-node-id': {'success': True, ...}, ...}
            all_succeeded = all(
                r.get('success', True) 
                for r in downstream_results.values()
            )
            
            if all_succeeded:
                await queue.ack(item)
                yield Event(type='queue:item_acked', data={'id': item.id})
            else:
                await queue.nack(item)
                yield Event(type='queue:item_nacked', data={'id': item.id})
        
        yield Result(outputs={}, stop=True)
```

The key is `await_downstream=True` — the executor pauses after each emit until all nodes triggered by that emission complete. This ensures items are only acknowledged after successful processing.

Note `onWorkflowComplete: 'grace:10000'` — this gives the processor up to 10 seconds to finish acknowledging the current item before being terminated. Without this, an item could be processed but never acknowledged.

## Multi-Emit with Mixed Behaviors

A node demonstrating different emission behaviors in the same executor.

```ts
{
  id: 'batch-processor',
  name: 'Batch Processor',
  category: 'transform',
  icon: 'Layers',
  
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'item', direction: 'out', mode: 'value', schema: { type: 'object' } },
    { id: 'urgent', direction: 'out', mode: 'value', schema: { type: 'object' } },
    { id: 'summary', direction: 'out', mode: 'value', schema: { type: 'object' } },
  ],
  
  controls: [
    { id: 'parallel', type: 'boolean', default: false },
  ],
}
```

```python
class BatchProcessorExecutor:
    node_type = "batch-processor"
    
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        parallel = config.get('parallel', False)
        
        results = []
        
        for item in items:
            if item.get('urgent'):
                # Urgent items: fire and forget, don't wait
                yield Result(outputs={'urgent': item})
            elif parallel:
                # Parallel mode: fire and forget, collect results later
                yield Result(outputs={'item': item})
            else:
                # Sequential mode: wait for each to complete
                downstream = yield Result(outputs={'item': item}, await_downstream=True)
                results.append(downstream)
        
        # Final summary after all items processed
        yield Result(outputs={'summary': {'count': len(items), 'results': results}}, stop=True)
```

Same node, three behaviors:
- Urgent items emit without waiting
- Parallel mode emits all at once
- Sequential mode waits for each before continuing

The `stop=True` on the final emit ensures clean termination.
