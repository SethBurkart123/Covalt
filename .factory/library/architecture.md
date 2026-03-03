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

### Frontend Plugin Registry
- Loads TypeScript node definitions from plugins
- Supports dynamic registration via setDynamicNodeDefinitions
- Optional custom React components per node type with generic fallback

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
