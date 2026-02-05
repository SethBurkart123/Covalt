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
  context.tsx                # FlowProvider + useFlow hook (state management)
  index.ts                   # Public API exports
  nodes/                     # Node definitions (just data!)
    index.ts                 # Registry: NODE_DEFINITIONS, createFlowNode(), getCompatibleNodeSockets()
    chat-start.ts            # Entry node
    agent.ts                 # LLM agent node
    mcp-server.ts            # MCP server tool source
    toolset.ts               # Toolset tool source

components/flow/             # React components
  canvas.tsx                 # ReactFlow wrapper, edge routing, connection logic
  add-node-menu.tsx          # Searchable node picker (cmdk), supports connection filtering
  node.tsx                   # Generic node renderer (ONE component for ALL nodes)
  socket.tsx                 # Handle/socket component
  parameter-row.tsx          # Parameter display logic
  properties-panel.tsx       # Selected node editor panel (uses useFlow)
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

2. **`lib/flow/context.tsx`** - The `FlowProvider` and `useFlow` hook. Manages all graph state:
   - `nodes`, `edges` - The graph data
   - `selectedNodeId`, `selectedNode`, `selectNode` - Selection state
   - `addNode`, `removeNode`, `updateNodeData` - Node operations
   - `loadGraph`, `clearGraph` - Bulk operations
   - `isValidConnection`, `onConnect` - Connection logic with type checking
   - `getConnectedInputs` - Helper for hybrid parameter visibility

3. **`lib/flow/nodes/agent.ts`** - The most complex node definition. Shows all parameter modes in action.

4. **`components/flow/canvas.tsx`** - The ReactFlow integration. Consumes `useFlow()` and renders:
   - `GradientEdge` - Renders gradient-colored edges based on socket types
   - Generic node component via `nodeTypes` map
   - Add node menu integration (Shift+A, right-click, connector drop)
   - Node placement mode with cursor following

5. **`components/flow/node.tsx`** - The generic node renderer. Loops through `definition.parameters` and renders `ParameterRow` for each.

6. **`components/flow/properties-panel.tsx`** - Selected node editor. Uses `useFlow()` for selection and `updateNodeData` for two-way binding.

## FlowContext API

The context is split into **state** and **actions** to prevent unnecessary re-renders:

```typescript
// For components that only need actions (won't re-render on drag)
const { updateNodeData, getConnectedInputs } = useFlowActions();

// For components that need state (will re-render on changes)
const { nodes, edges, selectedNodeId } = useFlowState();

// Combined (backwards compatible, but causes re-renders)
const { nodes, updateNodeData, ... } = useFlow();
```

**Performance tip:** Use `useFlowActions()` in node components. Use `useFlowState()` only where you need to react to state changes.

The `useFlow()` hook provides everything needed to interact with the graph from any component:

```typescript
const {
  // Graph data
  nodes,                    // FlowNode[]
  edges,                    // FlowEdge[]
  
  // Selection
  selectedNodeId,           // string | null
  selectedNode,             // FlowNode | null (derived)
  selectNode,               // (id: string | null) => void
  
  // Node operations
  addNode,                  // (type: string, position: {x, y}) => string (returns id)
  removeNode,               // (id: string) => void
  updateNodeData,           // (nodeId: string, paramId: string, value: unknown) => void
  updateNodePosition,       // (nodeId: string, position: {x, y}) => void - for placement mode
  
  // Bulk operations
  loadGraph,                // (nodes, edges, options?) => void - use { skipHistory: true } for init
  clearGraph,               // (options?) => void - use { skipHistory: true } to skip undo
  
  // ReactFlow handlers (pass to <ReactFlow>)
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  
  // Helpers
  getNode,                  // (id: string) => FlowNode | undefined
  getConnectedInputs,       // (nodeId: string) => Set<string>
  
  // History (undo/redo)
  undo,                     // () => void
  redo,                     // () => void
  canUndo,                  // boolean
  canRedo,                  // boolean
  recordDragEnd,            // () => void - call on onNodeDragStop
} = useFlow();
```

**Keyboard shortcuts:** `Cmd/Ctrl+Z` for undo, `Cmd/Ctrl+Shift+Z` for redo (handled in `FlowCanvas`).

**Debouncing:** `updateNodeData` uses debounced history (300ms debounce, 2s max wait) so typing doesn't spam undo states. Other mutations (`addNode`, `removeNode`, `onConnect`, etc.) record immediately.

## Canvas Interactions

### Add Node Menu

Three ways to open the add node menu:

| Trigger | Behavior |
|---------|----------|
| `Shift+A` | Opens menu at cursor position |
| Right-click canvas | Opens menu at click position |
| Drop connector on empty space | Opens **filtered** menu showing only compatible nodes |

The menu uses `cmdk` for fuzzy search. When opened via connector drop, it shows node+socket pairs that can accept the connection, grouped by category.

**Files:** `components/flow/add-node-menu.tsx`, `lib/flow/nodes/index.ts` (`getCompatibleNodeSockets`)

### Node Placement Mode

After selecting a node from the menu, the canvas enters **placement mode**:

- Node follows cursor
- **Left-click** to confirm placement
- **Escape** to cancel (removes node)
- **Right-click** to cancel and restore original position

This creates a smooth workflow: open menu → pick node → place it exactly where you want.

### Drop Connector to Add

The killer feature: drag a connector from any socket onto empty canvas space to:

1. Open the add node menu filtered to compatible nodes
2. Show which socket on each node would receive the connection
3. Auto-connect after placing the node

Example: drag from an Agent's `tools` output → menu shows MCP Server, Toolset, and other Agents (since agent→tools coercion is valid).

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

## Performance Optimizations

The flow system uses several techniques to prevent unnecessary re-renders:

### Triple Context Split

The context is split into THREE separate contexts:
- `SelectionContext` - just `selectedNodeId` and `selectNode` (changes only on selection)
- `FlowStateContext` - nodes, edges (changes frequently on drag/edit)
- `FlowActionsContext` - callbacks (stable, never changes)

```typescript
// Only re-renders when selection changes (not on drag!)
const { selectedNodeId, selectNode } = useSelection();

// Re-renders on any node/edge change
const { nodes, edges } = useFlowState();

// Never causes re-renders - stable callbacks
const { updateNodeData, addNode } = useFlowActions();

// Combined (backwards compatible, but causes more re-renders)
const { nodes, selectedNodeId, updateNodeData } = useFlow();
```

### Stable Callbacks via Refs

All action callbacks use refs internally to access current state:
```typescript
const nodesRef = useRef(nodes);
nodesRef.current = nodes;

const getNode = useCallback((id) => {
  return nodesRef.current.find(n => n.id === id);
}, []); // Empty deps = stable reference
```

### Memoized Components

- `GradientEdge` - wrapped in `memo()`
- `FlowNode` - wrapped in `memo()`
- `ParameterRow` - wrapped in `memo()`
- `Socket` - wrapped in `memo()`
- `defaultEdgeOptions` - hoisted to module level

### Stable Callback Props

Instead of inline arrow functions that break memoization:
```typescript
// ❌ Bad - new function every render
onChange={(v) => handleChange(param.id, v)}

// ✅ Good - stable reference
onParamChange={handleChange}  // Component calls handleChange(paramId, value)
```

### What to use where

| Component | Hook | Re-renders on drag? |
|-----------|------|---------------------|
| `FlowCanvasInner` | `useFlowState` + `useSelection` + `useFlowActions` | Yes (needs nodes for ReactFlow) |
| `FlowNode` | `useFlowActions` | No (only on data change) |
| `PropertiesPanel` | `useSelection` + `useFlowActions` + `useNodesData` | No (only on selection/data) |

### React Flow's useNodesData Hook

For components that need specific node data without re-rendering on every position change:

```typescript
import { useNodesData } from '@xyflow/react';

// Only re-renders when this specific node's DATA changes (not position)
const [nodeData] = useNodesData(nodeId ? [nodeId] : []);
```

`PropertiesPanel` uses this pattern to avoid re-rendering when dragging nodes.

## What's NOT Implemented Yet

1. **Persistence** - No saving/loading graphs to backend
2. **Graph compilation** - Converting graph to executable agent config
3. **Node palette sidebar** - Add menu works, but no always-visible palette
4. **Graph validation** - No cycle detection or error checking

## Design Decisions

- **Hub topology**: Agent is the hub. Tools connect TO it, chat flows INTO it.
- **Bidirectional sockets**: Agent's input socket is bidirectional so it can receive connections but also could initiate them in the future.
- **Gradient edges**: Edges show socket type via color gradient (purple -> amber when agent connects to tools).
- **Connection validation**: Uses `acceptsTypes` on parameters for type coercion rules.

## The Concept Docs

Read these for the full vision:
- `poc/agent-graph-editor.md` - Overall UX and user flows
- `poc/node.md` - Registry wrapper architecture
- `poc/parameter-driven-architecture.md` - Deep dive on the parameter system
