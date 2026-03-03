# Architecture

Architectural decisions, patterns discovered, and design notes.

**What belongs here:** Architectural decisions, discovered patterns, design rationale.

---

## Plugin System Architecture

### Plugin Manifest (TypeScript)
Each plugin exports a typed manifest from a TypeScript file. The manifest declares: id, name, version, nodes (with definition + executor paths), lifecycle hooks, and optional custom components.

### Backend Plugin Registry
- Discovers plugin packages and registers Python executors
- Supports in-process executors (builtin) and bun RPC executors (external)
- Lifecycle hook system: onNodeCreate, onConnectionValidate, onRouteExtract, onEntryResolve, onResponseExtract, onSocketTypePropagate
- Executor resolution: plugin-scoped namespace, deterministic precedence

### Route Index Ownership Invariant
`backend/services/node_route_index.py` treats `route_id` as globally unique at resolve time: `_ROUTE_ID_INDEX` maps each route ID to exactly one active `(node_type, route_id)` key using last-write-wins semantics.

When a duplicate route registration replaces an existing route, ownership in `_ROUTES_BY_AGENT` must transfer to the new owner and be removed from the old owner. `remove_agent_routes(agent_id)` must only delete routes still owned by that agent to avoid removing active mappings after ownership transfer.

Regression coverage for this invariant lives in `tests/test_backend_core_decoupling_routes.py` (cross-type collision resolution and stale-owner removal safety).

### Frontend Plugin Registry
- Loads TypeScript node definitions from plugins
- Supports dynamic registration via setDynamicNodeDefinitions
- Optional custom React components per node type with generic fallback

### Frontend Hook Context Contracts
For connection validation hooks, context must carry `sourceNodeType` and `targetNodeType` as the canonical node-type fields. Generic helpers that filter hooks by node type should evaluate those fields (or an explicitly normalized `nodeType`) to avoid silently skipping node-scoped `onConnectionValidate` handlers.

### Builtin Plugin
- Lives in `nodes/` directory
- All 13 built-in node types registered through the plugin API
- Uses in-process Python executors (fast path)

### Node Types
Core: chat-start, webhook-trigger, webhook-end, agent
AI: llm-completion, prompt-template
Flow: conditional, merge, reroute
Tools: mcp-server, toolset
Data: code
Utility: model-selector
