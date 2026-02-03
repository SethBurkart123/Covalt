# Parameter-Driven Node Architecture

A data-driven node system inspired by Blender, where nodes define parameters rather than custom UI.

## Core Principle

**Nodes define WHAT, not HOW.**

- Nodes declare their **parameters** (data schema)
- The UI layer interprets parameters and renders appropriate controls
- Parameter modes determine if it's a constant, hybrid, or pure socket
- Adding new nodes = defining parameter arrays, not writing React components

## Parameter System

### Parameter Modes

| Mode | Behavior | Example |
|------|----------|---------|
| `constant` | Always a control, never connectable | Dropdown for noise type, checkbox |
| `hybrid` | Shows control by default, hides when connected | Slider for "Scale" that accepts input |
| `input` | Just a socket on the left | Data from another node |
| `output` | Just a socket on the right | Result produced by node |

### Parameter Types

Core types the UI layer understands:

```typescript
type ParameterType = 
  | 'float'           // Slider with min/max
  | 'int'             // Integer input
  | 'string'          // Text input
  | 'boolean'         // Checkbox
  | 'enum'            // Dropdown
  | 'model'           // Special: provider+model picker
  | 'mcp-server'      // Special: MCP server selector
  | 'agent'           // Agent reference type
  | 'tools'           // Tools collection type
  | 'color'           // Color picker
  | 'json'            // JSON editor
  | 'text-area'       // Multi-line text
  ;
```

### Parameter Definition

```typescript
interface Parameter {
  id: string;                    // Unique within node
  type: ParameterType;
  label: string;                 // Display name
  mode: 'constant' | 'hybrid' | 'input' | 'output';
  
  // Type-specific options
  default?: unknown;
  min?: number;                  // For float/int
  max?: number;
  step?: number;
  values?: string[];             // For enum
  multiple?: boolean;            // For input: allow multiple connections
  
  // Socket appearance (for hybrid/input/output modes)
  socket?: {
    color: string;
    shape: 'circle' | 'square' | 'diamond';
  };
}
```

## Socket Type System

### Type Coercion Rules

Connectors have types, but types can coerce:

```typescript
interface SocketType {
  id: string;
  color: string;
  shape: 'circle' | 'square' | 'diamond';
  canConnectTo: string[];  // Types this can plug into
}

const SOCKET_TYPES: Record<string, SocketType> = {
  agent: {
    id: 'agent',
    color: '#7c3aed',      // Purple
    shape: 'circle',
    canConnectTo: ['agent', 'tools'],  // Agent can become a tool!
  },
  tools: {
    id: 'tools',
    color: '#f59e0b',      // Amber
    shape: 'square',
    canConnectTo: ['tools'],
  },
  float: {
    id: 'float',
    color: '#a1a1aa',      // Gray
    shape: 'circle',
    canConnectTo: ['float', 'int'],  // Float can connect to int (truncation)
  },
  // ... more types
};
```

## Node Definition

### Example: Noise Texture Node (Blender-style)

```typescript
export const nodeDefinition = {
  id: 'noise-texture',
  name: 'Noise Texture',
  category: 'texture',
  icon: 'Waves',
  
  parameters: [
    // Constants - always UI controls
    {
      id: 'dimensions',
      type: 'enum',
      label: 'Dimensions',
      mode: 'constant',
      values: ['1D', '2D', '3D', '4D'],
      default: '3D',
    },
    {
      id: 'noiseType',
      type: 'enum',
      label: 'Type',
      mode: 'constant',
      values: ['FBM', 'Perlin', 'Voronoi'],
      default: 'FBM',
    },
    {
      id: 'normalize',
      type: 'boolean',
      label: 'Normalize',
      mode: 'constant',
      default: true,
    },
    
    // Hybrids - UI control OR socket input
    {
      id: 'scale',
      type: 'float',
      label: 'Scale',
      mode: 'hybrid',
      default: 0.8,
      min: 0,
      max: 10,
      step: 0.1,
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    {
      id: 'detail',
      type: 'float',
      label: 'Detail',
      mode: 'hybrid',
      default: 0,
      min: 0,
      max: 15,
      step: 1,
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    {
      id: 'roughness',
      type: 'float',
      label: 'Roughness',
      mode: 'hybrid',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    
    // Pure inputs - just sockets
    {
      id: 'w',
      type: 'float',
      label: 'W',
      mode: 'input',
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    
    // Pure outputs
    {
      id: 'factor',
      type: 'float',
      label: 'Factor',
      mode: 'output',
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    {
      id: 'color',
      type: 'color',
      label: 'Color',
      mode: 'output',
      socket: { color: '#eab308', shape: 'circle' },
    },
  ],
} satisfies NodeDefinition;
```

### Example: Agent Node

```typescript
export const nodeDefinition = {
  id: 'agent',
  name: 'Agent',
  category: 'core',
  icon: 'Bot',
  
  parameters: [
    // Pure input - receives agent flow (from Chat Start or parent agent)
    {
      id: 'agentIn',
      type: 'agent',
      label: 'Agent',
      mode: 'input',
      socket: { color: '#7c3aed', shape: 'circle' },
    },
    
    // Constants - configuration UI
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'constant',
    },
    {
      id: 'name',
      type: 'string',
      label: 'Name',
      mode: 'constant',
      default: '',
    },
    {
      id: 'description',
      type: 'text-area',
      label: 'Description',
      mode: 'constant',
      default: '',
    },
    {
      id: 'instructions',
      type: 'text-area',
      label: 'Instructions',
      mode: 'constant',
      default: '',
    },
    
    // Hybrid - temperature can be set or driven by another node
    {
      id: 'temperature',
      type: 'float',
      label: 'Temperature',
      mode: 'hybrid',
      default: 1.0,
      min: 0,
      max: 2,
      step: 0.1,
      socket: { color: '#a1a1aa', shape: 'circle' },
    },
    
    // Input - multiple tools can connect
    {
      id: 'tools',
      type: 'tools',
      label: 'Tools',
      mode: 'input',
      multiple: true,
      socket: { color: '#f59e0b', shape: 'square' },
    },
    
    // Output - provides agent (can become a tool via type coercion!)
    {
      id: 'agentOut',
      type: 'agent',
      label: 'Agent',
      mode: 'output',
      socket: { color: '#7c3aed', shape: 'circle' },
    },
  ],
} satisfies NodeDefinition;
```

## UI Rendering Architecture

### Generic Node Component

```typescript
// components/node.tsx - ONE component for ALL nodes

interface NodeProps {
  definition: NodeDefinition;
  data: Record<string, unknown>;  // Current values
  connectedInputs: Set<string>;   // Which hybrid/input params have connections
  onParameterChange: (paramId: string, value: unknown) => void;
}

export function Node({ definition, data, connectedInputs, onParameterChange }: NodeProps) {
  const { parameters } = definition;
  
  // Group by mode for layout
  const inputs = parameters.filter(p => p.mode === 'input');
  const hybrids = parameters.filter(p => p.mode === 'hybrid');
  const constants = parameters.filter(p => p.mode === 'constant');
  const outputs = parameters.filter(p => p.mode === 'output');
  
  return (
    <div className="node">
      {/* Header with name and collapse toggle */}
      <NodeHeader title={definition.name} icon={definition.icon} />
      
      <div className="node-body">
        {/* Left side: inputs and hybrid inputs */}
        <div className="inputs">
          {[...inputs, ...hybrids].map(param => (
            <ParameterRow 
              key={param.id}
              param={param}
              value={data[param.id]}
              isConnected={connectedInputs.has(param.id)}
              onChange={(v) => onParameterChange(param.id, v)}
            />
          ))}
        </div>
        
        {/* Middle: constant controls */}
        <div className="constants">
          {constants.map(param => (
            <ParameterControl
              key={param.id}
              param={param}
              value={data[param.id] ?? param.default}
              onChange={(v) => onParameterChange(param.id, v)}
            />
          ))}
        </div>
        
        {/* Right side: outputs and hybrid outputs */}
        <div className="outputs">
          {[...outputs, ...hybrids].map(param => (
            <ParameterRow
              key={param.id}
              param={param}
              isOutput
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Parameter Control Mapping

```typescript
// components/parameter-control.tsx

const CONTROL_MAP: Record<ParameterType, React.ComponentType<ControlProps>> = {
  'float': FloatControl,      // Slider with number input
  'int': IntControl,          // Number input
  'string': StringControl,    // Text input
  'boolean': BooleanControl,  // Checkbox
  'enum': EnumControl,        // Dropdown
  'model': ModelPicker,       // Provider + model selector
  'mcp-server': MCPServerPicker,
  'color': ColorPicker,
  'json': JSONEditor,
  'text-area': TextAreaControl,
  // ...
};

export function ParameterControl({ param, value, onChange }: ControlProps) {
  const Control = CONTROL_MAP[param.type];
  if (!Control) return <div>Unknown type: {param.type}</div>;
  
  return <Control param={param} value={value} onChange={onChange} />;
}
```

### Parameter Row (Socket + Control)

```typescript
// components/parameter-row.tsx

interface ParameterRowProps {
  param: Parameter;
  value?: unknown;
  isConnected?: boolean;
  isOutput?: boolean;
  onChange?: (value: unknown) => void;
}

export function ParameterRow({ 
  param, 
  value, 
  isConnected, 
  isOutput,
  onChange 
}: ParameterRowProps) {
  const showControl = !isOutput && param.mode === 'hybrid' && !isConnected;
  
  return (
    <div className="parameter-row">
      {/* Left socket for inputs/hybrids */}
      {!isOutput && (param.mode === 'input' || param.mode === 'hybrid') && (
        <Socket 
          paramId={param.id}
          type={param.type}
          isInput
          color={param.socket?.color}
          shape={param.socket?.shape}
        />
      )}
      
      {/* Label */}
      <span className="label">{param.label}</span>
      
      {/* Control for hybrid (when not connected) */}
      {showControl && (
        <div className="inline-control">
          <ParameterControl param={param} value={value} onChange={onChange!} />
        </div>
      )}
      
      {/* Right socket for outputs/hybrids */}
      {(isOutput || param.mode === 'output' || param.mode === 'hybrid') && (
        <Socket
          paramId={param.id}
          type={param.type}
          isOutput
          color={param.socket?.color}
          shape={param.socket?.shape}
        />
      )}
    </div>
  );
}
```

## Type Safety

### Runtime Validation with Zod

```typescript
// Create Zod schemas from parameter definitions dynamically

function createParameterSchema(param: Parameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  
  switch (param.type) {
    case 'float':
      schema = z.number();
      if (param.min !== undefined) schema = schema.min(param.min);
      if (param.max !== undefined) schema = schema.max(param.max);
      break;
    case 'int':
      schema = z.number().int();
      break;
    case 'string':
    case 'text-area':
      schema = z.string();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'enum':
      schema = z.enum(param.values as [string, ...string[]]);
      break;
    // ... more types
    default:
      schema = z.unknown();
  }
  
  return param.default !== undefined ? schema.default(param.default) : schema;
}

export function createNodeDataSchema(definition: NodeDefinition): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  
  for (const param of definition.parameters) {
    if (param.mode !== 'output') {  // Outputs don't have data
      shape[param.id] = createParameterSchema(param);
    }
  }
  
  return z.object(shape);
}
```

### TypeScript Inference

```typescript
// Infer types from definition for autocomplete

type InferParameterType<P extends Parameter> = 
  P extends { type: 'float' | 'int' } ? number :
  P extends { type: 'boolean' } ? boolean :
  P extends { type: 'string' | 'text-area' } ? string :
  P extends { type: 'enum', values: infer V } ? V[number] :
  unknown;

type InferNodeData<T extends NodeDefinition> = {
  [K in T['parameters'][number] as K extends { mode: 'output' } ? never : K['id']]: 
    InferParameterType<K>;
};

// Usage:
const agentDef = /* ... agent definition ... */;
type AgentData = InferNodeData<typeof agentDef>;
// AgentData = { model: unknown, name: string, temperature: number, ... }
```

## Directory Structure

```
lib/flow/
├── index.ts                    # Public API
├── types.ts                    # Core type definitions
├── sockets.ts                  # Socket type registry + coercion
├── parameters.ts               # Parameter type definitions + validation
├── components/
│   ├── canvas.tsx              # ReactFlow wrapper
│   ├── node.tsx                # Generic node renderer (ONE component!)
│   ├── parameter-row.tsx       # Socket + label + optional control
│   ├── parameter-control.tsx   # Control mapping
│   ├── controls/               # Individual control components
│   │   ├── float.tsx           # Slider + number input
│   │   ├── enum.tsx            # Dropdown
│   │   ├── model-picker.tsx    # Provider + model selector
│   │   └── ...
│   └── properties-panel.tsx    # Selected node properties
├── nodes/
│   ├── index.ts                # Registry + imports
│   ├── chat-start.ts           # Parameter definition only
│   ├── agent.ts                # Parameter definition only
│   ├── mcp-server.ts           # Parameter definition only
│   ├── toolset.ts              # Parameter definition only
│   └── ...                     # Just add .ts files!
└── utils/
    ├── validation.ts           # Graph validation
    └── compilation.ts          # Graph → executable
```

## Adding a New Node

### Step 1: Create Definition

```typescript
// lib/flow/nodes/my-node.ts

export const nodeDefinition = {
  id: 'my-node',
  name: 'My Node',
  category: 'custom',
  icon: 'Sparkles',
  
  parameters: [
    {
      id: 'value',
      type: 'float',
      label: 'Value',
      mode: 'hybrid',
      default: 1.0,
      min: 0,
      max: 100,
    },
    {
      id: 'result',
      type: 'float',
      label: 'Result',
      mode: 'output',
    },
  ],
} satisfies NodeDefinition;

export default nodeDefinition;
```

### Step 2: Register

```typescript
// lib/flow/nodes/index.ts

import myNode from './my-node';
// ^^^ Add import here

export const NODE_DEFINITIONS = [
  chatStart,
  agent,
  // ...
  myNode,  // <-- Add to array
];
```

### Done!

No UI code written. The parameter-driven system handles it all.

## Connection Logic

### Socket Matching

```typescript
function canConnect(
  sourceType: string, 
  targetType: string,
  sourceParam: Parameter,
  targetParam: Parameter
): boolean {
  // 1. Type coercion check
  const sourceSocketType = SOCKET_TYPES[sourceType];
  if (!sourceSocketType.canConnectTo.includes(targetType)) {
    return false;
  }
  
  // 2. Multiple connections check
  if (!targetParam.multiple && hasConnection(targetParam.id)) {
    return false;
  }
  
  // 3. Cycle prevention (optional)
  if (wouldCreateCycle(sourceParam.id, targetParam.id)) {
    return false;
  }
  
  return true;
}
```

### Special Case: Agent → Tools Coercion

```typescript
// In SOCKET_TYPES:
agent: {
  id: 'agent',
  color: '#7c3aed',
  shape: 'circle',
  canConnectTo: ['agent', 'tools'],  // Key: agent can plug into tools!
}
```

When an agent output connects to a tools input:
- Visually: Purple circle → Amber square (colors mismatch is OK)
- Semantically: The agent becomes a tool
- Compilation: Agent node gets wrapped as a tool function

## Visual Design

### Socket Appearance

| Type | Color | Shape | Use Case |
|------|-------|-------|----------|
| `agent` | Purple (#7c3aed) | Circle | Agent flow |
| `tools` | Amber (#f59e0b) | Square | Tool connections |
| `float`/`int` | Gray (#a1a1aa) | Circle | Numeric data |
| `string` | Blue (#3b82f6) | Circle | Text data |
| `boolean` | Green (#10b981) | Diamond | Flags |
| `color` | Yellow (#eab308) | Circle | Color values |

### Node Layout

```
┌─────────────────────────────────────┐
│  🤖 Agent                    [-]    │  ← Header (icon + name + collapse)
├─────────────────────────────────────┤
│                                     │
│  ○ Agent            Model [GPT-4 ▼] │  ← Input socket + constants
│         │                           │
│  ○ Tools            Name [_______]  │  ← (multiple allowed)
│         │           Instructions    │
│  ◎ Temp  [━━━●━━━━]  [________]     │  ← Hybrid: socket + slider
│         │                           │
│  ○ ────────────────────── ○ Agent   │  ← Pure I/O on sides
│                                     │
└─────────────────────────────────────┘
```

- **Left side**: Input sockets (inputs + hybrid inputs)
- **Middle**: Constant controls + hybrid controls (when not connected)
- **Right side**: Output sockets (outputs + hybrid outputs)

## Backend Compilation

### Graph Walking

```typescript
// lib/flow/utils/compilation.ts

interface CompiledNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  resolvedInputs: Record<string, unknown>;  // Connected values
}

export function compileGraph(graph: FlowGraph): CompiledGraph {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const compiled = new Map<string, CompiledNode>();
  
  function compileNode(nodeId: string): CompiledNode {
    if (compiled.has(nodeId)) return compiled.get(nodeId)!;
    
    const node = nodeMap.get(nodeId)!;
    const def = getNodeDefinition(node.type);
    
    // Resolve connected inputs
    const resolvedInputs: Record<string, unknown> = {};
    
    for (const edge of graph.edges) {
      if (edge.target === nodeId) {
        const sourceNode = compileNode(edge.source);
        resolvedInputs[edge.targetHandle] = sourceNode;
      }
    }
    
    // Merge: resolved inputs override node data
    const finalData = { ...node.data, ...resolvedInputs };
    
    const result: CompiledNode = {
      id: nodeId,
      type: node.type,
      data: finalData,
      resolvedInputs,
    };
    
    compiled.set(nodeId, result);
    return result;
  }
  
  // Find entry point (Chat Start)
  const entry = graph.nodes.find(n => n.type === 'chat-start');
  if (!entry) throw new Error('No Chat Start node');
  
  return {
    entry: compileNode(entry.id),
    nodes: Array.from(compiled.values()),
  };
}
```

## Scaling to Hundreds of Nodes

This architecture scales because:

1. **No custom UI per node** - Just parameter arrays
2. **Centralized control mapping** - Add a new `ParameterType`, all nodes using it get the UI
3. **Self-contained definitions** - Each node is just a data object
4. **Easy testing** - Test the definition, not React components
5. **Backend parity** - Python can use same parameter schemas

### Adding a New Parameter Type

```typescript
// 1. Add to ParameterType union
// 2. Add to CONTROL_MAP
// 3. Add to createParameterSchema
// 4. Done - all nodes can now use it!
```

## Summary

- **Nodes define parameters**, not UI
- **Parameters have modes**: constant, hybrid, input, output
- **Hybrid mode** = slider/value by default, socket when connected
- **Socket types** define colors/shapes and coercion rules
- **One generic Node component** renders everything
- **Type safety** via Zod schemas created from definitions
- **Add nodes** by creating parameter arrays, not React code

This is Blender's approach. It works for hundreds of node types. It will work here.
