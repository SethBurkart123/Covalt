# Node Editor Wrapper Architecture

A type-safe wrapper around React Flow that centralizes node type definitions and provides a clean API for managing nodes from anywhere in the codebase.

## The Problem

React Flow is powerful but can get messy fast because:
1. Node types are just strings - easy to typo `"textUpdater"` vs `"textupdate"`
2. Node data shapes aren't enforced - you can pass anything
3. State management spreads across components
4. Adding nodes from different places leads to inconsistent `id` generation

## Proposed Structure

```
lib/flow/
├── registry.ts       # Node type definitions & validation
├── context.tsx       # Flow state management context
├── types.ts          # TypeScript types for everything
├── nodes/            # Custom node components
│   ├── index.ts      # Exports all nodes + nodeTypes map
│   └── *.tsx         # Individual node components
└── index.ts          # Public API
```

## 1. Type-Safe Node Registry (`registry.ts`)

```typescript
import { Node } from '@xyflow/react';

// Define all possible node types as a const
export const NODE_TYPES = {
  text: 'text',
  code: 'code', 
  image: 'image',
  // ... add more
} as const;

export type NodeType = typeof NODE_TYPES[keyof typeof NODE_TYPES];

// Define data shapes for each node type
export interface NodeDataMap {
  text: { content: string; fontSize?: number };
  code: { code: string; language: string };
  image: { src: string; alt?: string };
}

// Type-safe node creation
export type TypedNode<T extends NodeType> = Node<NodeDataMap[T], T>;

// Factory functions for creating nodes with proper defaults
export const nodeFactories = {
  text: (id: string, position: { x: number; y: number }, data: NodeDataMap['text']): TypedNode<'text'> => ({
    id,
    type: 'text',
    position,
    data,
  }),
  code: (id: string, position: { x: number; y: number }, data: NodeDataMap['code']): TypedNode<'code'> => ({
    id,
    type: 'code',
    position,
    data,
  }),
  // ... etc
} satisfies Record<NodeType, Function>;
```

## 2. Flow Context (`context.tsx`)

```typescript
import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { useNodesState, useEdgesState, addEdge, Connection, Edge } from '@xyflow/react';
import { NodeType, NodeDataMap, nodeFactories, TypedNode } from './registry';

interface FlowContextValue {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: ReturnType<typeof useNodesState>[2];
  onEdgesChange: ReturnType<typeof useEdgesState>[2];
  onConnect: (connection: Connection) => void;
  
  // Clean API for node operations
  addNode: <T extends NodeType>(
    type: T,
    position: { x: number; y: number },
    data: NodeDataMap[T]
  ) => string; // returns the new node id
  
  removeNode: (id: string) => void;
  updateNodeData: <T extends NodeType>(id: string, data: Partial<NodeDataMap[T]>) => void;
  getNode: (id: string) => Node | undefined;
}

const FlowContext = createContext<FlowContextValue | null>(null);

let nodeIdCounter = 0;
const generateId = () => `node-${++nodeIdCounter}-${Date.now()}`;

export function FlowProvider({ children, initialNodes = [], initialEdges = [] }: {
  children: ReactNode;
  initialNodes?: Node[];
  initialEdges?: Edge[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(<T extends NodeType>(
    type: T,
    position: { x: number; y: number },
    data: NodeDataMap[T]
  ): string => {
    const id = generateId();
    const factory = nodeFactories[type];
    const newNode = factory(id, position, data);
    setNodes((nds) => [...nds, newNode]);
    return id;
  }, [setNodes]);

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    // Also remove connected edges
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, [setNodes, setEdges]);

  const updateNodeData = useCallback(<T extends NodeType>(
    id: string,
    data: Partial<NodeDataMap[T]>
  ) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      )
    );
  }, [setNodes]);

  const getNode = useCallback(
    (id: string) => nodes.find((n) => n.id === id),
    [nodes]
  );

  const value = useMemo(() => ({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    updateNodeData,
    getNode,
  }), [nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, removeNode, updateNodeData, getNode]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used within FlowProvider');
  return ctx;
}
```

## 3. The Flow Component (`FlowCanvas.tsx`)

```typescript
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import { useFlow } from './context';
import { nodeTypes } from './nodes'; // Pre-built map

export function FlowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useFlow();

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
```

## 4. Usage from Anywhere

```typescript
// In a toolbar component
function Toolbar() {
  const { addNode } = useFlow();
  
  return (
    <button onClick={() => addNode('code', { x: 100, y: 100 }, { 
      code: '// hello', 
      language: 'typescript' 
    })}>
      Add Code Node
    </button>
  );
}

// In a sidebar
function Sidebar() {
  const { nodes, removeNode, updateNodeData } = useFlow();
  
  return (
    <div>
      {nodes.map(node => (
        <div key={node.id}>
          <span>{node.type}</span>
          <button onClick={() => removeNode(node.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

// Inside a custom node itself!
function CodeNode({ id, data }: NodeProps<NodeDataMap['code']>) {
  const { updateNodeData } = useFlow();
  
  return (
    <div>
      <Handle type="target" position={Position.Top} />
      <textarea 
        value={data.code}
        onChange={(e) => updateNodeData(id, { code: e.target.value })}
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

## Key Benefits

| Feature | Why It Matters |
|---------|----------------|
| **Single source of truth** | All node types defined in `registry.ts` |
| **Type safety** | Can't create a `"cde"` node or pass wrong data shape |
| **Consistent IDs** | One `generateId()` function, no collisions |
| **Clean API** | `addNode('code', pos, data)` from anywhere |
| **Edge cleanup** | `removeNode` automatically removes connected edges |
| **Extensible** | Add new node type = add to registry + create component |

## Future Considerations

- **Persistence**: Save/load flow state to database
- **Undo/Redo**: Track history of changes
- **Validation**: Ensure edges connect compatible node types
- **Serialization**: Export flows to JSON/YAML
