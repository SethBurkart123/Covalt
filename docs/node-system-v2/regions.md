# Regions

A region is a bounded subgraph with explicit entry and exit points. Regions enable subgraph reuse, structural ownership, and visual grouping.

## Boundaries

Every region has two special boundary nodes:

**Entry node** defines the region's inputs. Its output ports flow into the region. When the region is invoked, values are injected through the entry node's outputs.

**Exit node** defines the region's outputs. Its input ports receive from the region. When the region completes, values are collected from the exit node's inputs. The exit node also has a special output port that emits a handle to the entire region.

## Region Structure

```ts
interface Region {
  entry: NodeId;
  exit: NodeId;
  nodes: NodeId[];
  edges: Edge[];
}
```

The entry and exit nodes define the interface. Everything between them is the region's internal implementation.

## Visual Modes

Regions can be displayed in two ways.

### Subgraph Mode

The region collapses into a single node. The external node's ports mirror the entry and exit boundaries. Double-clicking opens the subgraph for editing.

This is clean and compact but hides the internal structure. Use it when:
- The region's implementation is stable
- You want a clean high-level view
- The region is reused in multiple places

### Closure Zone Mode

The region stays visible inline in the parent graph. The entry and exit nodes are visible, with internal nodes between them. A visual boundary (box or highlight) distinguishes the zone.

The exit node's region output connects to Evaluate nodes elsewhere in the graph. This enables visual debugging and multiple invocation points for the same region.

Use closure zones when:
- You're actively developing the region
- You want to see data flow through the region
- You need multiple invocation points in the same graph

## Region Invocation

When a node receives a region (via structural mode connection), it invokes through the runtime:

```python
result = await runtime.execute_region(
    region=regions['body'],
    inputs={'item': current_item, 'index': i}
)
```

The runtime:
1. Injects inputs through the entry node's output ports
2. Runs all internal nodes in topological order
3. Collects values from the exit node's input ports
4. Returns them as the result

A region can be invoked multiple times with different inputs. Each invocation is independent.

## The Evaluate Node

An Evaluate node is a consumer of region handles. It receives a region reference and exposes ports matching the region's interface.

```ts
{
  id: 'evaluate',
  ports: [
    { id: 'region', direction: 'in', mode: 'structural', schema: { type: 'region' } },
    // Dynamic ports generated from connected region's interface
  ],
}
```

When you connect a region to an Evaluate node, Evaluate's ports update to match:
- Input ports for each Entry output
- Output ports for each Exit input

This pattern separates definition (the closure zone) from invocation (the evaluate nodes). You can define a region once and invoke it from multiple places.

## Entry and Exit Node Definitions

```ts
// Entry node
{
  id: 'region-entry',
  name: 'Entry',
  ports: [
    // User adds ports to define region inputs
    // These appear as outputs (flowing into the region)
    { id: 'item', direction: 'out', mode: 'value', schema: { type: 'any' } },
    { id: 'index', direction: 'out', mode: 'value', schema: { type: 'number' } },
  ],
}

// Exit node
{
  id: 'region-exit',
  name: 'Exit',
  ports: [
    // User adds ports to define region outputs
    // These appear as inputs (receiving from the region)
    { id: 'result', direction: 'in', mode: 'value', schema: { type: 'any' } },
    
    // Always present: the region handle
    { id: 'region', direction: 'out', mode: 'value', schema: { type: 'region' } },
  ],
}
```

## Native Subgraphs

Native subgraphs use the standard node system. Any node from the main palette can be placed inside.

```ts
{
  id: 'my-subgraph',
  subgraph: {
    type: 'native',
  },
}
```

The Entry and Exit nodes define the interface. Inside, you wire standard nodes together.

## Foreign Subgraphs

Foreign subgraphs contain nodes from external systems — ComfyUI, n8n, or custom engines. These use a bridge:

```ts
{
  id: 'comfyui-workflow',
  subgraph: {
    type: 'foreign',
    bridge: 'comfyui',
  },
}
```

The bridge translates between our event/execution model and the foreign system.

### Bridge Responsibilities

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

### Subgraph Node Constraints

When editing a foreign subgraph:
- The node picker queries `bridge.getNodeDefinitions()` instead of the main registry
- Only nodes from that bridge are available — you cannot mix ComfyUI nodes with native nodes
- Each node renders using its own `ui.node` component if provided
- Connection validation uses `bridge.canConnect()` if defined
- Socket colors/shapes come from `bridge.socketTypes` if defined

This means a ComfyUI subgraph shows only ComfyUI nodes with ComfyUI's visual style.

### Foreign Execution

When executing a foreign subgraph:

```python
result = await runtime.execute_foreign(
    bridge='comfyui',
    graph=subgraph_definition,
    inputs=inputs
)
```

The runtime delegates to the bridge, which handles translation to the foreign system's execution model.

## Example: Loop Using Regions

A loop node receives a region and invokes it repeatedly:

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

```python
class LoopExecutor:
    async def execute(self, config, inputs, refs, regions, runtime):
        items = inputs['items']
        body = regions['body']
        
        results = []
        for i, item in enumerate(items):
            result = await runtime.execute_region(body, {'item': item, 'index': i})
            results.append(result.get('output'))
        
        yield Result(outputs={'results': results})
```

The loop doesn't reimplement execution — it asks the runtime to execute the region. This means nested loops, events, and all runtime features work correctly inside the body.

## Example: Closure Zone with Multiple Evaluates

Define a region once, invoke it multiple times:

```
┌─ Entry ──┐                              ┌─ Exit ───┐
│          │    ┌────────────────┐        │          │
│  item  ●─┼───▶│  Transform     │───────▶┼─● result │
│          │    └────────────────┘        │          │
└──────────┘                              │  region●─┼───┬───────────────┐
                                          └──────────┘   │               │
                                                         ▼               ▼
                                                  ┌─ Evaluate ─┐  ┌─ Evaluate ─┐
                                                  │            │  │            │
                                                  │  region ●  │  │  region ●  │
                                                  │  item   ●◀─┼──│  item   ●◀─┼──
                                                  │  result ●──┼─▶│  result ●──┼─▶
                                                  └────────────┘  └────────────┘
```

Both Evaluate nodes invoke the same region with different inputs.
