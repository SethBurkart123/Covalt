# Toolset & MCP Unification

This document explains the conceptual model for how toolsets and MCP servers work together in Covalt Desktop.

## Core Concepts

### Toolset

A **toolset** is the fundamental unit for organizing and configuring tools. It acts as a **namespace and configuration wrapper** that can aggregate tools from multiple sources.

A toolset provides:
- **Aggregation** - Bundle tools from various providers under one namespace
- **Override layer** - Configure renderers, rename tools, adjust descriptions, toggle confirmation requirements
- **Enable/disable control** - Turn all tools from a toolset on or off together

Toolsets can be:
- **Explicit** (`user_mcp=False`) - Created by the user via YAML manifest or ZIP import. Shows in the "Toolsets" UI section.
- **User MCP** (`user_mcp=True`) - Auto-generated when a user adds a standalone MCP server. Shows in the "MCP Servers" UI section. Provides the same capabilities but with reduced friction.

### Tool Provider

A **tool provider** is a source of tools. Different providers have different mechanisms for discovering and executing tools:

| Provider | Discovery | Execution | Storage |
|----------|-----------|-----------|---------|
| **MCP Server** | Runtime (via MCP protocol) | Remote (MCP call) | Connection config only |
| **Python Module** | Static (YAML manifest) | Local (Python function) | Entrypoint in `tools` table |
| **Docker** (future) | TBD | Container | TBD |

Tool providers are implementation details - the toolset abstraction unifies them.

### MCP Server Identity

Each MCP server is uniquely identified by a **server key**: `{toolset_id}~{server_id}`. API responses expose:
- `id` = server key (unique)
- `serverId` = original server ID from manifest/UI
- `toolsetId` = owning toolset

This allows duplicate server IDs across different toolsets without collisions.

### Tool Override

A **tool override** customizes how a tool appears and behaves without modifying the underlying provider. Overrides are stored per-toolset, meaning the same MCP server could have different configurations in different toolsets.

Overridable properties:
- `renderer` - Which UI renderer to use (code, markdown, html, etc.)
- `renderer_config` - Configuration passed to the renderer
- `name_override` - Display name (model still sees original ID)
- `description_override` - Custom description for the tool
- `requires_confirmation` - Whether user approval is needed before execution
- `enabled` - Hide specific tools from a provider

### Tool ID Format

Tool IDs follow a consistent format regardless of provider:

```
 mcp:{server_key}:{tool_name}  # MCP tools
{toolset_id}:{tool_id}     # Python toolset tools
{builtin_name}             # Built-in tools (no namespace)
```

For MCP tools, the `server_key` is `{toolset_id}~{server_id}`. The original `server_id` from the manifest/UI is exposed separately as `serverId`. Legacy `mcp:{server_id}:{tool_name}` identifiers are accepted only when the `server_id` maps unambiguously to a single server.

## Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                        TOOLSET                              │
│  - id, name, version, description                          │
│  - enabled (master switch)                                 │
│  - user_mcp (UI routing: MCP Servers vs Toolsets section)  │
└─────────────────────────────────────────────────────────────┘
         │
         │ has many
         ▼
┌─────────────────────────────────────────────────────────────┐
│              TOOL PROVIDERS                                 │
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │ toolset_mcp_servers │    │   toolset_files     │        │
│  │ (connection config) │    │ (Python modules)    │        │
│  └─────────────────────┘    └─────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
         │
         │ tools discovered/defined
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    TOOL OVERRIDES                           │
│  - toolset_id + tool_id (composite key)                    │
│  - renderer, renderer_config                               │
│  - name_override, description_override                     │
│  - requires_confirmation, enabled                          │
└─────────────────────────────────────────────────────────────┘
```

## User Flows

### Adding a Standalone MCP Server (Simple UI)

1. User clicks "Add Server" in MCP Servers section
2. User fills in connection details (command/args or URL)
3. Backend creates:
   - A `toolset` with `user_mcp=True` and `id={server_id}`
   - A `toolset_mcp_servers` entry linked to that toolset
4. MCP manager connects to the server
5. Tools are discovered at runtime
6. User can later add overrides (renderers, etc.) via the UI

### Creating an Explicit Toolset (YAML/ZIP)

1. User creates a `toolset.yaml` manifest defining:
   - Toolset metadata (id, name, version)
   - Python tools with entrypoints
   - MCP servers to include
   - Tool overrides (renderers, etc.)
2. User imports via ZIP upload
3. Backend creates:
   - A `toolset` with `user_mcp=False`
   - `toolset_files` for Python modules and artifacts
   - `tools` entries for Python tools
   - `toolset_mcp_servers` entries for declared MCP servers
   - `tool_overrides` entries from manifest

### Runtime Tool Resolution

1. When building the tool list for an agent:
   - Query enabled toolsets
   - For each MCP server: get discovered tools, apply overrides
   - For each Python tool: load from `tools` table, apply overrides
2. Tool IDs remain consistent (`mcp:{server_key}:{tool_name}`)
3. Overrides affect display/behavior but not the model's view of tool IDs

## Key Design Decisions

### Why `user_mcp` Instead of "Implicit Toolsets"?

The `user_mcp` flag is a **UI routing hint**, not a behavioral difference. Both user_mcp and explicit toolsets use the same underlying model. The flag simply determines where the toolset appears in the UI:
- `user_mcp=True` → "MCP Servers" section (streamlined UX)
- `user_mcp=False` → "Toolsets" section (full configuration)

### Why Not Store MCP Tools in the Database?

MCP tools are **ephemeral** - they're discovered at runtime when the server connects. Storing them would create sync issues when:
- Server adds new tools
- Server removes tools
- Server updates tool schemas

Instead, we only store **overrides**. At runtime:
1. Connect to MCP server
2. Discover tools via protocol
3. Check `tool_overrides` for any matching configurations
4. Apply overrides to the runtime tool objects

### Why Per-Toolset Overrides?

The same MCP server could theoretically be included in multiple toolsets with different configurations. Per-toolset overrides enable:
- Different renderers for the same tool in different contexts
- Disabling specific tools in one toolset but not another
- Custom descriptions tailored to the toolset's purpose

For user_mcp toolsets (standalone MCP servers), `toolset_id == server_id`, so this is effectively per-server configuration.

## Future Extensions

### Docker Containers (Planned)

A new tool provider type that runs tools in isolated containers:
- `toolset_docker_containers` table for container config
- Tools discovered via container metadata or manifest
- Same override system applies

### Tool Override Patterns (Potential)

Currently overrides are exact tool ID matches. Future enhancement could support patterns:
- `filesystem:*` - Apply to all tools from a server
- `*:read_*` - Apply to all read operations across servers
