# Controls and Methods

Controls are UI elements for node configuration. Methods are functions that nodes expose for other nodes or external systems to call. Together they enable patterns like dynamic option loading and variable forwarding to triggers.

## Controls

Controls define the UI elements in a node's configuration panel.

### Control Definition

```ts
interface Control {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'text' | 'code' | 'json' | 'custom';
  label: string;
  default?: any;
  placeholder?: string;
  expressions?: boolean;    // Allow {{ }} expressions
  options?: StaticOptions | DynamicOptions;
  ui?: () => Promise<Component>;  // Custom control rendering
}
```

### Control Types

| Type | Description | Options |
|------|-------------|---------|
| `string` | Single-line text input | — |
| `number` | Numeric input | `min`, `max`, `step` |
| `boolean` | Checkbox/toggle | — |
| `enum` | Dropdown selection | `options` required |
| `text` | Multi-line text area | `rows` |
| `code` | Code editor | `language` |
| `json` | JSON editor | — |
| `custom` | Custom React component | `ui` required |

### Static Options

For enums with fixed choices:

```ts
{
  id: 'format',
  type: 'enum',
  label: 'Format',
  options: ['json', 'xml', 'csv'],
}
```

### Expressions

Controls can allow expressions for dynamic values:

```ts
{
  id: 'query',
  type: 'string',
  label: 'Search Query',
  expressions: true,
  placeholder: '{{ $input.searchTerm }}',
}
```

When `expressions: true`, the control accepts `{{ }}` syntax that references input data.

### Custom Control Rendering

For complex controls, provide a React component:

```ts
{
  id: 'credentials',
  type: 'custom',
  label: 'Credentials',
  ui: () => import('./OAuthControl'),
}
```

The component receives the current value and a setter.

## Dynamic Options via Methods

Controls can load options dynamically by calling a method on the node.

### Declaring Dynamic Options

```ts
{
  id: 'model',
  type: 'enum',
  label: 'Model',
  options: {
    method: 'listModels',
    params: { provider: '{{ config.provider }}' },
  },
}
```

The `method` references a function on the node's executor. The `params` can include expressions that reference other config values.

### Implementing Methods

Methods are defined on the executor alongside `execute`:

```python
class AgentExecutor:
    node_type = "agent"
    
    async def listModels(self, params, context):
        provider = params.get('provider')
        models = await get_available_models(provider)
        return [
            {'value': m.id, 'label': m.name, 'group': m.provider}
            for m in models
        ]
    
    async def execute(self, config, inputs, refs, regions, runtime):
        # normal execution
```

### Option Shape

Methods returning options should return this shape:

```ts
type OptionResult = Array<{
  value: string;
  label: string;
  group?: string;
  icon?: string;
}>;
```

### When Options Load

The UI calls the method when:
- The control is rendered
- A dependency changes (e.g., `provider` changes)
- The user explicitly refreshes

## Methods

Methods are utility functions that nodes expose. They're separate from the main execution — they run independently and return immediately.

### Method Declaration

```ts
{
  id: 'agent',
  name: 'Agent',
  
  methods: {
    listModels: {
      params: {
        provider: { type: 'string', optional: true },
      },
      returns: { type: 'array', items: { type: 'core:option' } },
    },
    getCapabilities: {
      params: {},
      returns: { type: 'object' },
    },
  },
}
```

### Method Implementation

```python
class AgentExecutor:
    async def listModels(self, params, context):
        # context includes runtime, node config, etc.
        provider = params.get('provider') or context.config.get('default_provider')
        return await fetch_models(provider)
    
    async def getCapabilities(self, params, context):
        return {
            'streaming': True,
            'tools': True,
            'vision': context.config.get('model', '').startswith('gpt-4'),
        }
```

### Invoking Methods

From other nodes via runtime:

```python
options = await runtime.invoke_method('agent-1', 'listModels', {'provider': 'openai'})
```

From external API:

```
POST /api/nodes/{nodeId}/methods/{methodName}
Content-Type: application/json

{"provider": "openai"}
```

## Variable Forwarding

A common pattern is forwarding control definitions from one node to a trigger, allowing runtime configuration.

### The Pattern

1. A node (Agent) has configurable controls
2. Another node (Agent Variables) reads those definitions
3. The trigger (Chat Start) receives the definitions and renders UI
4. User selections flow back to the original node

### Agent Variables Node

This node outputs control definitions from a referenced node:

```ts
{
  id: 'agent-variables',
  name: 'Agent Variables',
  
  ports: [
    { id: 'definitions', direction: 'out', mode: 'value', 
      schema: { type: 'array', items: { type: 'core:control-definition' } } },
  ],
  
  controls: [
    { id: 'source', type: 'node-ref', label: 'Source Node', nodeTypes: ['agent'] },
  ],
}
```

```python
class AgentVariablesExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        source_id = config['source']
        source_node = runtime.get_node(source_id)
        definition = runtime.get_definition(source_node['type'])
        
        controls = []
        for control in definition.controls:
            ctrl = {
                'id': control.id,
                'type': control.type,
                'label': control.label,
                'default': source_node['data'].get(control.id, control.default),
            }
            
            # Include method reference for dynamic options
            if control.options and control.options.get('method'):
                ctrl['options'] = {
                    'nodeId': source_id,
                    'method': control.options['method'],
                    'params': control.options.get('params', {}),
                }
            elif control.options:
                ctrl['options'] = control.options
            
            controls.append(ctrl)
        
        yield Result(outputs={'definitions': controls})
```

### Trigger Consuming Definitions

Chat Start has an input for variable definitions:

```ts
{
  id: 'chat-start',
  
  ports: [
    { id: 'variable_definitions', direction: 'in', mode: 'value',
      schema: { type: 'array', items: { type: 'core:control-definition' } } },
    { id: 'message', direction: 'out', mode: 'value', schema: { type: 'string' } },
    { id: 'variables', direction: 'out', mode: 'value', schema: { type: 'object' } },
  ],
}
```

When rendering its UI:
1. Read connected `variable_definitions`
2. For each definition, render the appropriate control
3. For controls with `options.method`, call the method to populate choices
4. Collect user selections into `variables` output

### Wiring Variables Back

The variables output connects to nodes that need the values:

```
┌─────────────┐     ┌──────────────────┐
│   Agent     │◀────│ Agent Variables  │
│   Variables │     │                  │
└──────┬──────┘     └────────┬─────────┘
       │                     │
       │ definitions         │
       ▼                     │
┌─────────────┐              │
│ Chat Start  │              │
│             │              │
│ variables ●─┼──────────────┼─────┐
└─────────────┘              │     │
                             │     │
                             │     ▼
                        ┌────┴─────────┐
                        │    Agent     │
                        │              │
                        │  model: {{ $input.variables.model }}
                        │  temp:  {{ $input.variables.temp }}
                        └──────────────┘
```

The Agent uses expressions to pull from the variables object.

## External API Access

Methods and control definitions are accessible via API for building custom UIs.

### Get Control Definitions

```
GET /api/workflows/{workflowId}/variables
```

Returns the control definitions that the workflow's trigger exposes.

### Call Method

```
POST /api/nodes/{nodeId}/methods/{methodName}
Content-Type: application/json

{"provider": "openai"}
```

Returns the method result (e.g., list of model options).

### Run Workflow with Variables

```
POST /api/workflows/{workflowId}/run
Content-Type: application/json

{
  "message": "Hello",
  "variables": {
    "model": "gpt-4",
    "temperature": 0.7
  }
}
```

The trigger receives the variables and outputs them for downstream nodes.

## Example: Full Variable Flow

### 1. Agent Definition

```ts
{
  id: 'agent',
  controls: [
    {
      id: 'model',
      type: 'enum',
      label: 'Model',
      options: { method: 'listModels' },
    },
    {
      id: 'temperature',
      type: 'number',
      label: 'Temperature',
      default: 0.7,
      min: 0,
      max: 2,
    },
  ],
  methods: {
    listModels: {
      params: {},
      returns: { type: 'array' },
    },
  },
}
```

### 2. Agent Variables wired to Chat Start

The definitions flow from Agent → Agent Variables → Chat Start.

### 3. Chat Start renders the controls

User sees a model dropdown (populated by calling `listModels` on the Agent) and a temperature slider.

### 4. User makes selections

Chat Start outputs:
```ts
{
  message: "Hello",
  variables: {
    model: "claude-3",
    temperature: 0.9
  }
}
```

### 5. Agent receives values

Through expressions or direct connection:
```python
model = inputs.get('variables', {}).get('model') or config['model']
temp = inputs.get('variables', {}).get('temperature') or config['temperature']
```

No magic, no auto-discovery. Just data flowing through ports, with methods providing dynamic content.
