# Node Plugin System — Implementation Plan

The concrete, file-by-file playbook for implementing the architecture described in `node-plugin-system.md`.

## The Barrel Firewall

The single most important architectural fact: **11 frontend files import exclusively through `@/lib/flow`**. That barrel re-exports everything. If we keep the barrel's public API identical and just change where it sources from, 11 files need zero changes.

Only **10 files** need actual edits in Phase 1. Zero behavior change. Pure reorganization.

## Phase 1: Foundation (pure refactor)

### Step 1.1 — Create the `nodes/` directory structure

```
nodes/
  _types.ts                 # MOVED from app/lib/flow/types.ts (no changes to file contents)
  _registry.ts              # MOVED from app/lib/flow/nodes/index.ts (imports updated)
  _types.py                 # NEW — Python executor protocol + DataValue + NodeEvent
  _registry.py              # NEW — Python auto-discovery engine
  __init__.py               # NEW — makes nodes/ a Python package, re-exports from _registry

  core/
    chat-start/
      definition.ts         # MOVED from app/lib/flow/nodes/chat-start.ts
      executor.py           # NEW — extracted from graph_executor.py

    agent/
      definition.ts         # MOVED from app/lib/flow/nodes/agent.ts
      executor.py           # NEW — extracted from graph_executor.py

  tools/
    mcp-server/
      definition.ts         # MOVED from app/lib/flow/nodes/mcp-server.ts
      executor.py           # NEW — extracted from graph_executor.py _resolve_tools()

    toolset/
      definition.ts         # MOVED from app/lib/flow/nodes/toolset.ts
      executor.py           # NEW — extracted from graph_executor.py _resolve_tools()
```

Each `__init__.py` needed for Python subpackages:
- `nodes/__init__.py`
- `nodes/core/__init__.py`
- `nodes/core/chat-start/__init__.py`
- `nodes/core/agent/__init__.py`
- `nodes/tools/__init__.py`
- `nodes/tools/mcp-server/__init__.py`
- `nodes/tools/toolset/__init__.py`

### Step 1.2 — Config change

**`tsconfig.json`** — Add one line to `compilerOptions.paths`:

```json
"@nodes/*": ["./nodes/*"]
```

That's it. The existing `**/*.ts` include glob already covers `nodes/`. Next.js + Turbopack resolves through tsconfig paths. No `next.config.ts` changes. No ESLint changes. No `package.json` changes.

### Step 1.3 — Move TypeScript files

**`app/lib/flow/types.ts` -> `nodes/_types.ts`**

The file has zero imports — pure type definitions. Contents don't change. Just moves.

**`app/lib/flow/nodes/chat-start.ts` -> `nodes/core/chat-start/definition.ts`**

One import changes:
```
BEFORE: import type { NodeDefinition } from '../types';
AFTER:  import type { NodeDefinition } from '../../_types';
```

**`app/lib/flow/nodes/agent.ts` -> `nodes/core/agent/definition.ts`**

Same pattern — `'../types'` becomes `'../../_types'`.

**`app/lib/flow/nodes/mcp-server.ts` -> `nodes/tools/mcp-server/definition.ts`**

Same — `'../types'` becomes `'../../_types'`.

**`app/lib/flow/nodes/toolset.ts` -> `nodes/tools/toolset/definition.ts`**

Same — `'../types'` becomes `'../../_types'`.

**`app/lib/flow/nodes/index.ts` -> `nodes/_registry.ts`**

This one has more import changes:

```
BEFORE:
  import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from '../types';
  import { canConnect } from '../sockets';
  import { chatStart } from './chat-start';
  import { agent } from './agent';
  import { mcpServer } from './mcp-server';
  import { toolset } from './toolset';

AFTER:
  import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from './_types';
  import { canConnect } from '@/lib/flow/sockets';
  import { chatStart } from './core/chat-start/definition';
  import { agent } from './core/agent/definition';
  import { mcpServer } from './tools/mcp-server/definition';
  import { toolset } from './tools/toolset/definition';
```

All exports stay identical. The public API doesn't change.

### Step 1.4 — Update internal flow files (3 files)

**`app/lib/flow/sockets.ts`** — One import changes:

```
BEFORE: import type { SocketTypeId, SocketShape, Parameter } from './types';
AFTER:  import type { SocketTypeId, SocketShape, Parameter } from '@nodes/_types';
```

**`app/lib/flow/context.tsx`** — Two imports change:

```
BEFORE:
  import type { FlowNode, FlowEdge, Parameter, SocketTypeId } from './types';
  import { getNodeDefinition } from './nodes';

AFTER:
  import type { FlowNode, FlowEdge, Parameter, SocketTypeId } from '@nodes/_types';
  import { getNodeDefinition } from '@nodes/_registry';
```

**`app/lib/flow/index.ts`** — The barrel. Three import sources change:

```
BEFORE:
  } from './types';
  } from './nodes';

AFTER:
  } from '@nodes/_types';
  } from '@nodes/_registry';
```

The `'./sockets'` and `'./context'` imports stay — those files don't move.

### Step 1.5 — Fix the one barrel bypass (1 file)

**`app/components/flow/add-node-menu.tsx`** line 7:

```
BEFORE: import { getNodesByCategory, getCompatibleNodeSockets } from '@/lib/flow/nodes';
AFTER:  import { getNodesByCategory, getCompatibleNodeSockets } from '@/lib/flow';
```

Uses the barrel instead of reaching in directly. The barrel already exports both.

### Step 1.6 — Delete old location

Remove `app/lib/flow/nodes/` directory entirely (all files moved to `nodes/`).
Remove `app/lib/flow/types.ts` (moved to `nodes/_types.ts`).

### Step 1.7 — Verification

Run `bun run build`. If it passes, the frontend refactor is complete. Zero behavior change — every component renders identically.

---

### Step 1.8 — Create Python executor protocol

**NEW FILE: `nodes/_types.py`**

```python
"""Node executor protocol and runtime types."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol
import time


# ── Runtime data ────────────────────────────────────────────────────

@dataclass
class DataValue:
    """What flows through edges at runtime."""
    type: str       # matches SocketTypeId
    value: Any


@dataclass
class BinaryRef:
    """Pointer to large content stored on disk."""
    ref: str
    mime_type: str
    size: int
    filename: str | None = None


# ── Events ──────────────────────────────────────────────────────────

@dataclass
class NodeEvent:
    """Emitted by nodes during execution. Powers the chat UI + canvas."""
    node_id: str
    node_type: str
    event_type: str         # started | progress | completed | error | agent_event
    run_id: str = ""
    data: dict[str, Any] | None = None
    timestamp: float = field(default_factory=time.time)


# ── Execution result ────────────────────────────────────────────────

@dataclass
class ExecutionResult:
    """What execute() returns. Outputs dict = which output ports have values."""
    outputs: dict[str, DataValue]
    events: list[NodeEvent] = field(default_factory=list)


# ── Structural result types ─────────────────────────────────────────

@dataclass
class ToolsResult:
    tools: list[Any]

@dataclass
class AgentResult:
    agent: Any          # Agent | Team

@dataclass
class MetadataResult:
    metadata: dict[str, Any]

StructuralResult = ToolsResult | AgentResult | MetadataResult


# ── Contexts ────────────────────────────────────────────────────────

@dataclass
class BuildContext:
    """Provided to structural executors during Phase 1."""
    node_id: str
    chat_id: str | None
    tool_sources: list[dict[str, Any]]
    sub_agents: list[Any]
    tool_registry: Any

@dataclass
class FlowContext:
    """Provided to flow executors during Phase 2."""
    node_id: str
    chat_id: str | None
    run_id: str
    state: Any              # FlowState
    agent: Any | None       # Agent | Team built in Phase 1
    tool_registry: Any


# ── Executor protocol ───────────────────────────────────────────────

class StructuralExecutor(Protocol):
    node_type: str
    def build(self, data: dict[str, Any], context: BuildContext) -> StructuralResult: ...

class FlowExecutor(Protocol):
    node_type: str
    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext,
    ) -> ExecutionResult | AsyncIterator[NodeEvent | ExecutionResult]: ...
```

### Step 1.9 — Create Python auto-discovery registry

**NEW FILE: `nodes/_registry.py`**

```python
"""Node executor auto-discovery.

Scans nodes/**/executor.py, imports each, registers by node_type.
Drop a folder with executor.py, restart, it appears.
"""
from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# node_type -> executor instance
EXECUTORS: dict[str, Any] = {}


def _discover() -> None:
    """Walk nodes/**/executor.py and register each executor."""
    root = Path(__file__).parent

    for executor_path in root.rglob("executor.py"):
        # Build the module path: nodes.core.agent.executor -> relative to project root
        relative = executor_path.relative_to(root.parent)
        module_path = str(relative.with_suffix("")).replace("/", ".").replace("\\", ".")

        try:
            module = importlib.import_module(module_path)
            executor = getattr(module, "executor", None)

            if executor is None:
                logger.warning(f"nodes: {module_path} has no 'executor' export")
                continue

            node_type = getattr(executor, "node_type", None)
            if node_type is None:
                logger.warning(f"nodes: {module_path} executor has no 'node_type'")
                continue

            EXECUTORS[node_type] = executor
            logger.debug(f"nodes: registered '{node_type}' from {module_path}")

        except Exception as e:
            logger.error(f"nodes: failed to load {module_path}: {e}")


_discover()


def get_executor(node_type: str) -> Any | None:
    return EXECUTORS.get(node_type)


def list_node_types() -> list[str]:
    return list(EXECUTORS.keys())
```

**NEW FILE: `nodes/__init__.py`**

```python
"""Node plugin system. Auto-discovers executors from subdirectories."""
from nodes._registry import EXECUTORS, get_executor, list_node_types

__all__ = ["EXECUTORS", "get_executor", "list_node_types"]
```

### Step 1.10 — Create executor files (extracted from graph_executor.py)

**NEW FILE: `nodes/core/chat-start/executor.py`**

```python
"""Chat Start node — bridge between the chat interface and the graph."""
from __future__ import annotations
from typing import Any
from nodes._types import MetadataResult, BuildContext

class ChatStartExecutor:
    node_type = "chat-start"

    def build(self, data: dict[str, Any], context: BuildContext) -> MetadataResult:
        return MetadataResult(metadata={
            "includeUserTools": bool(data.get("includeUserTools", False)),
        })

executor = ChatStartExecutor()
```

**NEW FILE: `nodes/core/agent/executor.py`**

```python
"""Agent node — builds Agno Agent or Team from graph data."""
from __future__ import annotations
from typing import Any

from agno.agent import Agent
from agno.db.in_memory import InMemoryDb
from agno.team import Team

from backend.services.model_factory import get_model
from nodes._types import AgentResult, BuildContext

_agent_db = InMemoryDb()


class AgentExecutor:
    node_type = "agent"

    def build(self, data: dict[str, Any], context: BuildContext) -> AgentResult:
        model = _resolve_model(data)
        tools = _collect_tools(context)
        instructions = [data["instructions"]] if data.get("instructions") else None

        if not context.sub_agents:
            return AgentResult(agent=Agent(
                name=data.get("name", "Agent"),
                model=model, tools=tools or None,
                description=data.get("description", ""),
                instructions=instructions,
                markdown=True, stream_events=True, db=_agent_db,
            ))

        return AgentResult(agent=Team(
            name=data.get("name", "Agent"),
            model=model, tools=tools or None,
            description=data.get("description", ""),
            instructions=instructions,
            members=context.sub_agents,
            markdown=True, stream_events=True,
            stream_member_events=True, db=_agent_db,
        ))


def _resolve_model(data: dict[str, Any]) -> Any:
    model_str = data.get("model", "")
    if ":" not in model_str:
        raise ValueError(f"Invalid model format '{model_str}' — expected 'provider:model_id'")
    provider, model_id = model_str.split(":", 1)
    return get_model(provider, model_id)


def _collect_tools(context: BuildContext) -> list[Any]:
    tools: list[Any] = []
    for source in context.tool_sources:
        tools.extend(source.get("tools", []))
    return tools


executor = AgentExecutor()
```

**NEW FILE: `nodes/tools/mcp-server/executor.py`**

```python
"""MCP Server node — resolves tools from an MCP server."""
from __future__ import annotations
from typing import Any
from nodes._types import ToolsResult, BuildContext


class McpServerExecutor:
    node_type = "mcp-server"

    def build(self, data: dict[str, Any], context: BuildContext) -> ToolsResult:
        server_id = data.get("server")
        if not server_id:
            return ToolsResult(tools=[])
        tools = context.tool_registry.resolve_tool_ids(
            [f"mcp:{server_id}"], chat_id=context.chat_id,
        )
        return ToolsResult(tools=tools)

executor = McpServerExecutor()
```

**NEW FILE: `nodes/tools/toolset/executor.py`**

```python
"""Toolset node — resolves tools from a registered toolset."""
from __future__ import annotations
from typing import Any
from nodes._types import ToolsResult, BuildContext


class ToolsetExecutor:
    node_type = "toolset"

    def build(self, data: dict[str, Any], context: BuildContext) -> ToolsResult:
        toolset_id = data.get("toolset")
        if not toolset_id:
            return ToolsResult(tools=[])
        tools = context.tool_registry.resolve_tool_ids(
            [f"toolset:{toolset_id}"], chat_id=context.chat_id,
        )
        return ToolsResult(tools=tools)

executor = ToolsetExecutor()
```

### Step 1.11 — Refactor graph_executor.py

Replace the if/elif dispatch in `_resolve_tools()` with a registry lookup. Replace `_build_node()` with executor delegation. Keep the external API (`build_agent_from_graph` returning `GraphBuildResult`) identical.

**The refactored structure** (every function <30 lines per AGENTS.md):

```
build_agent_from_graph()        # 8 lines — orchestrator
  _parse_graph()                # 3 lines — extract nodes + edges
  _extract_metadata()           # 5 lines — read chat-start config
  _find_root_agent_id()         # 12 lines — walk edges from chat-start
  _build_node()                 # 15 lines — recursive, delegates to executors
    _get_tool_sources()         # 14 lines — partition edges (unchanged)
    _resolve_tools()            # 10 lines — registry lookup, no if/elif
  _merge_extra_tools()          # 8 lines — bolt on user-selected tools
```

Key change in `_resolve_tools()`:

```python
# BEFORE:
if source_type == "mcp-server":
    server_id = source_data.get("server")
    tools.extend(registry.resolve_tool_ids([f"mcp:{server_id}"], ...))
elif source_type == "toolset":
    toolset_id = source_data.get("toolset")
    tools.extend(registry.resolve_tool_ids([f"toolset:{toolset_id}"], ...))
else:
    logger.warning(f"Unknown tool source node type: {source_type}")

# AFTER:
from nodes import get_executor

executor = get_executor(source_type)
if executor is None:
    logger.warning(f"No executor for node type: {source_type}")
    continue
result = executor.build(source_data, BuildContext(...))
if isinstance(result, ToolsResult):
    tools.extend(result.tools)
```

Key change in `_build_node()`:

```python
# BEFORE:
# 54 lines of inline Agent/Team construction

# AFTER:
executor = get_executor("agent")
context = BuildContext(
    node_id=node_id, chat_id=chat_id,
    tool_sources=resolved_tool_sources,
    sub_agents=[_build_node(sid, ...) for sid in sub_agent_ids],
    tool_registry=get_tool_registry(),
)
result = executor.build(data, context)
return result.agent
```

### Step 1.12 — Verification

```bash
bun run build                  # Frontend still builds
bun run backend                # Backend starts, agents still work
```

Test: open the agent editor, create a graph with Agent + MCP Server + Toolset, run a chat. Everything works identically to before.

**Phase 1 is done.** Zero behavior change. The codebase is reorganized for extensibility.

---

## Phase 2: Flow Engine

### Step 2.1 — Add FlowState and flow execution engine

**NEW FILE: `backend/services/flow_executor.py`**

The flow execution engine. Runs Phase 2 — executes flow nodes in topological order.

Core loop (see manifesto for the full algorithm):
1. Partition graph into structural + flow subgraphs
2. Topological sort flow nodes
3. For each node: gather inputs from upstream output ports, call `execute()`, store outputs
4. Skip nodes whose required inputs aren't satisfied (dead branches)
5. Forward NodeEvents to the chat UI via the existing BroadcastingChannel

Key functions:
```
run_flow()                     # Entry point — returns AsyncIterator[NodeEvent]
  _partition_graph()           # Separate structural vs flow edges
  _topological_sort()          # Order flow nodes
  _gather_inputs()             # Pull DataValues from upstream output ports
  _has_required_inputs()       # Check if node can execute
  _run_executor()              # Call execute(), handle sync vs async generator
```

### Step 2.2 — Add flow_step content block type

**EDIT: `backend/commands/streaming.py`**

Add handling for `NodeEvent` objects from the flow engine. Translate them into `flow_step` content blocks that the chat UI can render:

```python
# When flow executor yields a NodeEvent:
content_block = {
    "type": "flow_step",
    "node_id": event.node_id,
    "node_type": event.node_type,
    "status": event.event_type,   # started | completed | error
    "data": event.data,
}
```

**EDIT: Frontend content block renderer**

Add a `FlowStepBlock` React component that renders flow events as expandable cards in the chat. Similar style to the existing `ToolCallBlock` — shows node name, status, expandable detail.

### Step 2.3 — Wire flow execution into the streaming pipeline

**EDIT: `backend/commands/streaming.py`**

After `build_agent_from_graph()` (Phase 1), check if the graph has flow nodes. If so, run the flow engine instead of directly calling `agent.arun()`:

```python
result = build_agent_from_graph(graph_data, chat_id=chat_id, ...)

if has_flow_nodes(graph_data):
    async for event in run_flow(graph_data, result.agent, chat_id, user_message):
        # translate event to content blocks, send to client
else:
    # existing behavior — run agent directly
    async for event in agent.arun(message, stream=True):
        ...
```

### Step 2.4 — Verification

Build a test graph: Chat Start -> Agent (structural, with tools). Run it. Verify flow engine detects "no flow nodes" and falls through to existing behavior. Zero regression.

---

## Phase 3: First Flow Nodes

### Step 3.1 — LLM Completion node

The simplest flow node. Prompt in, text out.

```
nodes/ai/
  __init__.py
  llm-completion/
    __init__.py
    definition.ts        # Parameters: model, prompt, temperature, max_tokens
    executor.py          # Resolves model, calls astream, yields token events
```

Parameters: `model` (model-picker), `prompt` (text-area, hybrid — can be socket input or constant), `temperature` (float), `max_tokens` (int).

Output sockets: `text` (type: text), `usage` (type: json).

Executor: resolve model via `get_model()`, stream tokens, yield `NodeEvent(event_type="progress")` per token, final `ExecutionResult` with text output.

### Step 3.2 — Prompt Template node

Variable interpolation. The glue node.

```
nodes/ai/
  prompt-template/
    __init__.py
    definition.ts        # Parameters: template (text-area), output format
    executor.py          # Mustache render against input data
```

Input socket: `data` (type: json). Output socket: `text` (type: text).

Executor: receive JSON from input, render Mustache template, return text. Synchronous — instant execution.

### Step 3.3 — Conditional node

First flow control node. Proves branching works.

```
nodes/flow/
  __init__.py
  conditional/
    __init__.py
    definition.ts        # Parameters: field, operator, value
    executor.py          # Evaluate condition, populate true OR false output port
```

Input socket: `input` (type: any). Output sockets: `true` (type: any), `false` (type: any).

Executor: evaluate condition against input data, populate one output port. The other stays empty. Engine naturally follows the live branch.

### Step 3.4 — Verification

Build a test flow:
```
Chat Start -> Prompt Template -> LLM Completion -> Conditional
                                                    ├─ true  -> (agent responds one way)
                                                    └─ false -> (agent responds another way)
```

Verify: tokens stream in chat, conditional branches correctly, dead branch is skipped.

---

## Phase 4: Type Coercion, Execution Modes, and Hybrid Nodes

Phase 4 addresses fundamental limitations that prevented nodes from participating in both structural composition and data flow pipelines.

### The Problems

1. **Agent and Chat Start had no flow sockets** — they couldn't participate in data pipelines.
2. **No type coercion** — `canConnect()` only did exact type match, so `text` couldn't connect to `string`.
3. **Graph partitioning was socket-type-based** — naive and inflexible. `STRUCTURAL_SOCKET_TYPES = {"agent", "tools"}` decided which nodes were structural vs flow based on their edge types, not their capabilities.
4. **No `executionMode` field** on NodeDefinition to declare how nodes participate.

### Step 4.1 — Type Coercion System

Two files, mirrored:

| File | Purpose |
|------|---------|
| `app/lib/flow/sockets.ts` | Editor-time: `IMPLICIT_COERCIONS` Set + `canCoerce()` function |
| `nodes/_coerce.py` | Runtime: `COERCION_TABLE` dict with actual converter functions + `coerce()` |

**Why two files?** The TypeScript side gates editor connections (can you draw this wire?). The Python side performs runtime conversion (transform the data before it reaches the target node). They must stay in sync.

**Coercion table entries:**
- Numeric widening: `int→float`
- Primitives → string: `int→string`, `float→string`, `boolean→string`
- string ↔ text: identity (same data, different semantic)
- Structured → string/text: `json→string` (compact), `json→text` (pretty)
- Message unpacking: `message→text`, `message→string`, `message→json`
- Document unpacking: `document→text`, `document→json`
- `any` wildcard: anything connects to `any`, `any` connects to anything

**Key design decisions:**
- **`acceptsTypes` overrides coercion.** If a parameter has `acceptsTypes`, only those exact types are allowed. If not, coercion is checked. This gives node authors precise control.
- **Coercion is not transitive.** `int→string` and `string→text` doesn't imply `int→text`. Each path must be explicit. (Though `int→string` IS in the table.)
- **Runtime coercion happens in `_gather_inputs()`** inside the flow engine. The edge's `data.targetType` tells the engine what the target expects.

### Step 4.2 — `executionMode` on NodeDefinition

**EDIT: `nodes/_types.ts`**

```typescript
export type ExecutionMode = 'structural' | 'flow' | 'hybrid';

export interface NodeDefinition {
  // ...existing fields...
  executionMode: ExecutionMode;
}
```

- `structural`: Build-time only. Has `build()`, no `execute()`. (MCP Server, Toolset)
- `flow`: Runtime only. Has `execute()`, no `build()`. (LLM Completion, Prompt Template, Conditional)
- `hybrid`: Both phases. Has `build()` AND `execute()`. (Agent, Chat Start)

Every node definition now declares its mode. This is validated by `node-contracts.test.ts`.

### Step 4.3 — Capability-Based Node Partitioning

**REWRITE: `backend/services/flow_executor.py`**

The old `partition_graph()` function inspected edge socket types to decide which nodes were structural vs flow. This was replaced by `find_flow_nodes()` which checks **executor capabilities**:

```python
def find_flow_nodes(nodes, executors):
    """Return nodes whose executors have an execute() method."""
    return [n for n in nodes if _is_flow_capable(n["type"], executors)]

def _is_flow_capable(node_type, executors):
    executor = _get_executor(node_type, executors)
    return executor is not None and hasattr(executor, "execute")
```

**Why capability-based?** A node's participation in flow should depend on what it CAN DO, not what it's wired to. A hybrid node with only structural edges today might get flow edges tomorrow.

**Edge filtering still uses socket types.** `STRUCTURAL_HANDLE_TYPES = {"agent", "tools"}` filters out structural edges for data routing. This is correct because structural edges genuinely carry different things (topology, tool composition) than flow edges (runtime data).

### Step 4.4 — Hybrid Agent Node

**EDIT: `nodes/core/agent/definition.ts`** — Added flow sockets:
- `input` (input, type: `text`, accepts: `['text', 'string', 'message']`)
- `response` (output, type: `text`)

**EDIT: `nodes/core/agent/executor.py`** — Added `execute()` method:

```python
async def execute(self, data, inputs, context):
    text = _extract_text(inputs.get("input", DataValue("text", "")))
    agent = context.agent or _build_minimal_agent(data)
    response = await agent.arun(text)
    return ExecutionResult(outputs={
        "response": DataValue(type="text", value=response.content),
    })
```

### Step 4.5 — Hybrid Chat Start Node

**EDIT: `nodes/core/chat_start/definition.ts`** — Added `message` output socket (type: `message`).

**EDIT: `nodes/core/chat_start/executor.py`** — Added `execute()` method that reads `context.state.user_message` and emits it as a `DataValue(type="message", value={"role": "user", "content": ...})`.

### Step 4.6 — Verification

Test counts after Phase 4:
- Python: 83 passed (flow engine), 38 passed (coercion) = 121 total
- TypeScript: 132 passed (up from 90)

All flow engine integration tests pass with the new capability-based partitioning.

---

## Phase 5+: Data, Integration, RAG nodes

Each follows the exact same pattern — create a folder, write `definition.ts` + `executor.py`, restart. No framework changes. No engine changes. Just new folders.

### Data nodes
- `nodes/data/json-transform/` — JSONata expression evaluation
- `nodes/data/filter/` — Array filtering with condition operators
- `nodes/data/type-converter/` — Explicit type coercion
- `nodes/data/text-split/` — Split/join text by delimiter or chunk size

### Integration nodes
- `nodes/integration/http-request/` — HTTP calls with auth, retry, pagination
- `nodes/integration/webhook-trigger/` — Register HTTP endpoint as flow trigger

### RAG nodes
- `nodes/rag/document-loader/` — PDF, web, text file loading
- `nodes/rag/text-chunker/` — Split documents for embedding
- `nodes/rag/embedding/` — Text to vector via embedding model
- `nodes/rag/vector-search/` — Query vector databases

### Advanced flow
- `nodes/flow/loop/` — Container loop with internal sub-graph
- `nodes/flow/merge/` — Wait for multiple inputs with trigger rules

---

## File Change Summary

### Phase 1 — Files that MOVE (6 files)

| From | To |
|------|----|
| `app/lib/flow/types.ts` | `nodes/_types.ts` |
| `app/lib/flow/nodes/index.ts` | `nodes/_registry.ts` |
| `app/lib/flow/nodes/chat-start.ts` | `nodes/core/chat-start/definition.ts` |
| `app/lib/flow/nodes/agent.ts` | `nodes/core/agent/definition.ts` |
| `app/lib/flow/nodes/mcp-server.ts` | `nodes/tools/mcp-server/definition.ts` |
| `app/lib/flow/nodes/toolset.ts` | `nodes/tools/toolset/definition.ts` |

### Phase 1 — Files that get EDITED (4 files)

| File | What changes |
|------|-------------|
| `tsconfig.json` | Add `"@nodes/*": ["./nodes/*"]` to paths |
| `app/lib/flow/sockets.ts` | Import path for types |
| `app/lib/flow/context.tsx` | Import paths for types + nodes |
| `app/lib/flow/index.ts` | Import paths for types + nodes |

### Phase 1 — Files that get a TRIVIAL FIX (1 file)

| File | What changes |
|------|-------------|
| `app/components/flow/add-node-menu.tsx` | `@/lib/flow/nodes` -> `@/lib/flow` (use barrel) |

### Phase 1 — Files that need NO changes (11 files)

All external consumers of `@/lib/flow` — the barrel's public API is preserved:

- `app/components/flow/canvas.tsx`
- `app/components/flow/node.tsx`
- `app/components/flow/properties-panel.tsx`
- `app/components/flow/socket.tsx`
- `app/components/flow/parameter-row.tsx`
- `app/components/flow/controls/index.tsx`
- `app/components/flow/controls/float.tsx`
- `app/components/flow/controls/boolean.tsx`
- `app/components/flow/controls/text-area.tsx`
- `app/contexts/agent-editor-context.tsx`
- `app/(app)/(pages)/agents/edit/page.tsx`

### Phase 1 — NEW files created (Python)

| File | Purpose |
|------|---------|
| `nodes/__init__.py` | Package init, re-exports registry |
| `nodes/_types.py` | Executor protocol, DataValue, NodeEvent |
| `nodes/_registry.py` | Auto-discovery engine |
| `nodes/core/__init__.py` | Subpackage |
| `nodes/core/chat-start/__init__.py` | Subpackage |
| `nodes/core/chat-start/executor.py` | Chat Start structural executor |
| `nodes/core/agent/__init__.py` | Subpackage |
| `nodes/core/agent/executor.py` | Agent structural executor |
| `nodes/tools/__init__.py` | Subpackage |
| `nodes/tools/mcp-server/__init__.py` | Subpackage |
| `nodes/tools/mcp-server/executor.py` | MCP Server tool resolver |
| `nodes/tools/toolset/__init__.py` | Subpackage |
| `nodes/tools/toolset/executor.py` | Toolset tool resolver |

### Phase 1 — Backend EDIT (1 file)

| File | What changes |
|------|-------------|
| `backend/services/graph_executor.py` | if/elif -> registry lookup via `nodes.get_executor()` |

### Phase 1 — Files DELETED

| Path | Reason |
|------|--------|
| `app/lib/flow/nodes/` (entire directory) | Contents moved to `nodes/` |
| `app/lib/flow/types.ts` | Moved to `nodes/_types.ts` |

---

## What Stays Put

These files don't move. They're part of the flow editor UI, not the node definition system:

- `app/lib/flow/sockets.ts` — Socket type registry (colors, shapes, connection rules). Stays because it's a UI concern.
- `app/lib/flow/context.tsx` — FlowProvider (React state management). Stays because it's React-specific.
- `app/lib/flow/index.ts` — Barrel export. Stays as the public API for frontend consumers.
- `app/components/flow/*` — All React components. Stay because they're UI.

The separation is clean: **`nodes/`** owns what a node IS (definition + executor). **`app/lib/flow/`** owns how nodes are RENDERED and EDITED in the UI.
