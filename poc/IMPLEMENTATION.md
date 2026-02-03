# POC Implementation Guide

A parameter-driven visual node editor for building AI agent graphs. This doc explains what's been built and where to find everything.

## Quick Start: See It Working

Visit `/test-flow` in the app. It renders 5 nodes in a hub topology (Chat Start -> Agent <- tools/sub-agent) with gradient-colored edges.

**File:** `app/(app)/(pages)/test-flow/page.tsx`

## Architecture Overview

The system follows a **Blender-inspired parameter-driven approach**: nodes define WHAT (parameters), not HOW (UI). One generic node component renders all node types based on their definitions.

```
lib/flow/                    # Core definitions (pure data)
  types.ts                   # ParameterType, Parameter, NodeDefinition
  sockets.ts                 # SOCKET_TYPES registry + canConnect()
  nodes/                     # Node definitions (just data!)
    index.ts                 # Registry: NODE_DEFINITIONS, createFlowNode()
    chat-start.ts            # Entry node
    agent.ts                 # LLM agent node
    mcp-server.ts            # MCP server tool source
    toolset.ts               # Toolset tool source

components/flow/             # React components
  canvas.tsx                 # ReactFlow wrapper, edge routing, connection logic
  node.tsx                   # Generic node renderer (ONE component for ALL nodes)
  socket.tsx                 # Handle/socket component
  parameter-row.tsx          # Parameter display logic
  properties-panel.tsx       # Selected node editor panel
  controls/                  # Parameter type -> control mapping
    index.tsx                # ParameterControl + registry
    float.tsx, string.tsx, etc.
    model-picker.tsx         # Model selection
    mcp-server-picker.tsx    # MCP server selection
    toolset-picker.tsx       # Toolset selection
```

## Key Concepts

### Parameter Modes

| Mode | Behavior |
|------|----------|
| `constant` | Always a UI control, never connectable |
| `hybrid` | Control by default, hides when socket connected |
| `input` | Pure input socket (left side) |
| `output` | Pure output socket (right side) |

### Socket Types

Defined in `lib/flow/sockets.ts`:

| Type | Color | Shape | Use |
|------|-------|-------|-----|
| `agent` | Purple #7c3aed | Circle | Agent flow |
| `tools` | Amber #f59e0b | Square | Tool connections |
| `float` | Gray | Circle | Numeric data |
| `string` | Blue | Circle | Text data |
| `boolean` | Green | Diamond | Flags |

### Agent -> Tools Coercion

The magic: an Agent output can connect to a Tools input. This makes sub-agents possible. The `agent` node's tools socket has `acceptsTypes: ['tools', 'agent']`.

## Files to Read First

1. **`lib/flow/types.ts`** - All the TypeScript types. Start here to understand the data model.

2. **`lib/flow/nodes/agent.ts`** - The most complex node definition. Shows all parameter modes in action.

3. **`components/flow/canvas.tsx`** - The ReactFlow integration. Key functions:
   - `GradientEdge` - Renders gradient-colored edges based on socket types
   - `onConnect` - Handles new connections with type checking
   - `isValidConnection` - Uses `canConnect()` for type coercion

4. **`components/flow/node.tsx`** - The generic node renderer. Loops through `definition.parameters` and renders `ParameterRow` for each.

5. **`components/flow/parameter-row.tsx`** - Decides what to show based on parameter mode and connection state.

## Adding a New Node Type

1. Create definition in `lib/flow/nodes/my-node.ts`:
```typescript
import type { NodeDefinition } from '../types';

export const myNode = {
  id: 'my-node',
  name: 'My Node',
  category: 'utility',
  icon: 'Sparkles',
  parameters: [
    { id: 'input', type: 'string', mode: 'input', socket: { type: 'string' } },
    { id: 'value', type: 'float', mode: 'hybrid', default: 1.0, min: 0, max: 10 },
    { id: 'output', type: 'string', mode: 'output', socket: { type: 'string' } },
  ],
} as const satisfies NodeDefinition;
```

2. Register in `lib/flow/nodes/index.ts`:
```typescript
import { myNode } from './my-node';
const NODE_LIST = [..., myNode];
```

Done. No React code needed.

## Adding a New Parameter Type

1. Add to `ParameterType` union in `lib/flow/types.ts`
2. Create control in `components/flow/controls/my-control.tsx`
3. Register in `components/flow/controls/index.tsx`

## Current Node Definitions

### chat-start
Entry point. Single output socket (agent type) with `maxConnections: 1`.

### agent
The hub node. Has:
- `agent` input (bidirectional - can both receive and initiate connections)
- `tools` input (accepts both tools and agents!)
- `model`, `name`, `description`, `instructions` as constants

### mcp-server / toolset
Tool providers. Single `tools` output socket.

## What's NOT Implemented Yet

1. **State management context** - Currently nodes/edges are local state in test page
2. **Persistence** - No saving/loading graphs
3. **Graph compilation** - Converting graph to executable agent config
4. **Drag from palette** - No node palette UI yet
5. **Undo/redo** - No history tracking
6. **Graph validation** - No cycle detection or error checking
7. **Properties panel data binding** - Changes don't flow back to canvas properly

## Design Decisions

- **Hub topology**: Agent is the hub. Tools connect TO it, chat flows INTO it.
- **Bidirectional sockets**: Agent's input socket is bidirectional so it can receive connections but also could initiate them in the future.
- **Gradient edges**: Edges show socket type via color gradient (purple -> amber when agent connects to tools).
- **Connection validation**: Uses `acceptsTypes` on parameters for type coercion rules.

## The Concept Docs

Read these for the full vision:
- `poc/agent-graph-editor.md` - Overall UX and user flows
- `poc/node.md` - Registry wrapper architecture (not fully implemented)
- `poc/parameter-driven-architecture.md` - Deep dive on the parameter system
