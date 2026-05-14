# Ports and Schemas

Ports are connection points on nodes. Each port has a direction, a mode, and a schema. Together these determine what can connect to what and how data flows.

## Port Definition

```ts
interface Port {
  id: string;
  direction: 'in' | 'out';
  mode: 'value' | 'reference' | 'structural';
  schema: Schema;
  multiple?: boolean;
}
```

## Direction

A port is either an input (`in`) or an output (`out`). Outputs connect to inputs. You cannot connect two inputs or two outputs directly.

## Mode

Mode determines what flows through the connection and who controls execution.

### Value Mode

Value mode is the default data flow. When the source node completes, its output value is delivered to the target node's input. The runtime controls when execution happens — it runs nodes in topological order based on dependencies.

```ts
{ id: 'text', direction: 'in', mode: 'value', schema: { type: 'string' } }
```

Use value mode when:
- You need the result of another node's computation
- The upstream node should run before yours
- You're building a data transformation pipeline

### Reference Mode

Reference mode gives the target a callable handle. The source doesn't execute automatically. The target decides when (and whether) to call it, and with what inputs.

```ts
{ id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'tool' }, multiple: true }
```

The handle includes:
- The callable's input and output schemas
- Metadata (name, description)
- An `invoke()` method

Use reference mode when:
- You want to call something on demand (tools)
- You need to call something multiple times with different inputs
- The timing of execution matters (lazy evaluation)

### Structural Mode

Structural mode gives the target full access to a region of the graph. The target receives the region's definition, configuration, all internal nodes and edges, and the ability to invoke it. The target becomes the executor for that region — the runtime skips those nodes in its normal topological pass.

```ts
{ id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } }
```

The region descriptor includes:
- Entry and exit node definitions
- All internal nodes and edges
- Configuration values
- An `invoke()` capability (via runtime)

Use structural mode when:
- You want to control how a subgraph executes (loops, parallel)
- You need to inspect the graph structure itself
- You're building custom execution semantics

## Multiple Connections

By default, a port accepts one connection. Setting `multiple: true` allows multiple connections.

```ts
{ id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'tool' }, multiple: true }
```

For inputs with multiple connections:
- Value mode: receives an array of values
- Reference mode: receives an array of handles
- Structural mode: receives an array of regions

## Schemas

Schemas define the shape of data that flows through ports. They enable connection-time validation and provide structure for tool parameter generation.

### Schema Structure

```ts
interface Schema {
  type: string;
  items?: Schema;                        // For arrays
  properties?: Record<string, Schema>;   // For objects
  required?: string[];                   // Required object properties
}
```

### Built-in Types

| Type | Description |
|------|-------------|
| `string` | Text |
| `number` | Numeric values |
| `boolean` | True or false |
| `binary` | Raw bytes (files, images, audio) |
| `array` | Ordered collection with typed items |
| `object` | Key-value structure with typed properties |
| `any` | Accepts anything (escape hatch) |
| `function` | A callable |

### Schema Examples

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
```

### Namespaced Types

Plugins and nodes can define custom types using namespaced identifiers:

```ts
{ type: 'gmail:email' }
{ type: 'comfyui:image' }
{ type: 'slack:message' }
{ type: 'core:tool' }
```

The namespace is typically the plugin or provider ID. Core types use `core:` or can omit the namespace for built-in types.

### The Tool Type

Tools are common enough to warrant a standard shape:

```ts
// core:tool
{
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    invoke: { type: 'function' },
  },
  required: ['name', 'invoke']
}
```

Any node can output tools. Any node can consume tools via reference-mode connections.

## Connection Compatibility

When connecting ports, the system checks compatibility.

### Direction Check

Source must be `out`, target must be `in`.

### Mode Compatibility

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

The pattern: you can always "upgrade" to a more powerful mode (value → reference → structural) but not downgrade.

### Schema Compatibility

| Rule | Example |
|------|---------|
| Exact match | `string` ↔ `string` |
| Coercion | `number` → `string` |
| Any accepts all | Target `any` accepts any source |
| Array wrapping | Single item → array (auto-wrapped) |
| Namespace match | `gmail:email` only matches `gmail:email` |

### Visual Feedback

When dragging a connection:
- Incompatible ports are dimmed
- Compatible ports highlight
- If multiple modes are possible, the most specific is chosen

## Port Examples

### Simple Transform Node

```ts
{
  id: 'uppercase',
  ports: [
    { id: 'text', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'result', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
}
```

### Agent Consuming Tools

```ts
{
  id: 'agent',
  ports: [
    { id: 'message', direction: 'in', mode: 'value', schema: { type: 'string' } },
    { id: 'tools', direction: 'in', mode: 'reference', schema: { type: 'tool' }, multiple: true },
    { id: 'response', direction: 'out', mode: 'value', schema: { type: 'string' } },
  ],
}
```

### Loop Node with Structural Body

```ts
{
  id: 'loop',
  ports: [
    { id: 'items', direction: 'in', mode: 'value', schema: { type: 'array' } },
    { id: 'body', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    { id: 'results', direction: 'out', mode: 'value', schema: { type: 'array' } },
  ],
}
```

### Tool Provider Node

```ts
{
  id: 'gmail',
  ports: [
    { id: 'tools', direction: 'out', mode: 'value', schema: { type: 'array', items: { type: 'tool' } } },
  ],
}
```
