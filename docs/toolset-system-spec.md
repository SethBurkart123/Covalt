# Toolset System Specification

## Overview

A system for extensible tools with rich rendering, built around:
- **DB as source of truth** for toolset/tool/renderer configuration
- **Per-chat CAS workspace** for versioned file storage across message branches
- **Python tools** that operate on the workspace folder
- **Config-driven renderers** that display tool output richly
- **YAML+ZIP bundles** for import/export

---

## 1. Data Model (DB Schema)

### 1.1 `toolsets` table

Installed toolset packages.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique toolset identifier (e.g., `app-builder`) |
| `name` | TEXT | Display name |
| `version` | TEXT | Semantic version |
| `description` | TEXT | Short description |
| `enabled` | BOOL | Global enable/disable |
| `installed_at` | TEXT | ISO timestamp |
| `source_type` | TEXT | `zip`, `local`, `url` |
| `source_ref` | TEXT | Original path/URL (for updates) |
| `manifest_version` | TEXT | Schema version of toolset.yaml |

### 1.2 `toolset_files` table

Files belonging to a toolset package.

| Column | Type | Description |
|--------|------|-------------|
| `toolset_id` | TEXT FK | References toolsets.id |
| `path` | TEXT | Relative path within toolset |
| `kind` | TEXT | `python`, `artifact`, `asset`, `config` |
| `sha256` | TEXT | Content hash |
| `size` | INT | File size in bytes |
| `stored_path` | TEXT | Absolute path where file is stored |

PK: (`toolset_id`, `path`)

### 1.3 `tools` table

Logical tool registry (builtin + toolset tools).

| Column | Type | Description |
|--------|------|-------------|
| `tool_id` | TEXT PK | Stable identifier (e.g., `write_file`, `mytools:analyze`) |
| `toolset_id` | TEXT FK NULL | NULL for builtin tools |
| `name` | TEXT | Display name (can be overridden by YAML) |
| `description` | TEXT | Tool description (can be overridden by YAML) |
| `input_schema` | TEXT | DEPRECATED - schema is now inferred from @tool decorator |
| `requires_confirmation` | BOOL | Needs user approval before run |
| `enabled` | BOOL | Tool is active |
| `entrypoint` | TEXT | For python tools: `module:function` |

### 1.4 `tool_overrides` table

Override configuration per tool (per toolset). This is the canonical place for renderer overrides and other tool metadata tweaks.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Override row id |
| `toolset_id` | TEXT FK | References toolsets.id |
| `tool_id` | TEXT | Tool identifier within toolset (`toolset_id:tool_id` for Python tools, `server_id:tool_name` for MCP) |
| `renderer` | TEXT | `code`, `document`, `html`, `frame` |
| `renderer_config` | TEXT | JSON config object |
| `name_override` | TEXT | Optional display name override |
| `description_override` | TEXT | Optional description override |
| `requires_confirmation` | BOOL | Optional override for confirmation |
| `enabled` | BOOL | Disable tool when false |

Unique: (`toolset_id`, `tool_id`)

`renderer_config` schema per renderer type (stored as JSON):

```yaml
# code renderer
file: "$args.path"           # or content: "$return.code"
language: "auto"             # or explicit: "python", "javascript"
editable: true

# document renderer
file: "$args.path"           # or content: "$return.text"
editable: true

# html renderer
artifact: "./artifacts/viz.html"   # path relative to toolset
data: "$return"                     # JSON injected as window.__TOOL_DATA__

# frame renderer
url: "http://localhost:$return.port"
# or
port: "$return.port"
```

### 1.5 `toolset_mcp_servers` table

MCP servers declared by toolsets.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | MCP server identifier |
| `toolset_id` | TEXT FK | References toolsets.id |
| `server_type` | TEXT | `stdio`, `sse`, `streamable-http` |
| `enabled` | BOOL | Enable/disable server |
| `command` | TEXT | Command for stdio servers |
| `args` | TEXT | JSON args array |
| `cwd` | TEXT | Working directory |
| `url` | TEXT | URL for HTTP/SSE servers |
| `headers` | TEXT | JSON headers map |
| `env` | TEXT | JSON env map |
| `requires_confirmation` | BOOL | Default confirmation for tools |
| `created_at` | TEXT | ISO timestamp |

PK: (`toolset_id`, `id`)

### 1.6 `workspace_manifests` table

Versioned workspace state per chat.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Manifest ID (uuid or message_id) |
| `chat_id` | TEXT FK | References chats.id |
| `parent_id` | TEXT NULL | Parent manifest (for branching) |
| `files` | TEXT | JSON: `{path: sha256, ...}` |
| `created_at` | TEXT | ISO timestamp |
| `source` | TEXT | `user_upload`, `tool_run`, `branch`, `edit` |
| `source_ref` | TEXT NULL | message_id or tool_call_id |

### 1.7 `tool_calls` table

Record of tool invocations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Tool call ID |
| `chat_id` | TEXT FK | References chats.id |
| `message_id` | TEXT | Message that triggered this call |
| `tool_id` | TEXT | Tool that was called |
| `args` | TEXT | JSON arguments |
| `result` | TEXT | JSON result (or summary) |
| `render_plan` | TEXT | JSON render plan for UI |
| `status` | TEXT | `pending`, `running`, `success`, `error` |
| `error` | TEXT NULL | Error message if failed |
| `started_at` | TEXT | ISO timestamp |
| `finished_at` | TEXT NULL | ISO timestamp |
| `pre_manifest_id` | TEXT NULL | Workspace state before run |
| `post_manifest_id` | TEXT NULL | Workspace state after run |

### 1.8 Additions to `chats` table

| Column | Type | Description |
|--------|------|-------------|
| `active_manifest_id` | TEXT NULL | Current workspace manifest |

---

## 2. Per-Chat Workspace + CAS Versioning

### 2.1 Filesystem Layout

```
data/
  chats/
    <chat_id>/
      workspace/          # Materialized working directory (latest leaf)
      blobs/              # Content-addressed storage
        ab/
          abcd1234...     # Files stored by SHA-256 hash
        cd/
          cdef5678...
```

### 2.2 Operations

**Store file**
```
hash = sha256(content)
path = blobs/{hash[:2]}/{hash}
if not exists(path): write(path, content)
return hash
```

**Create manifest**
```
manifest = {path: store_file(content) for path, content in files}
insert workspace_manifests row
return manifest_id
```

**Materialize workspace**
```
given manifest_id:
  manifest = get_manifest(manifest_id)
  clear workspace/ directory
  for path, hash in manifest.files:
    copy blobs/{hash[:2]}/{hash} -> workspace/{path}
```

**Snapshot workspace**
```
given workspace_dir, parent_manifest_id:
  files = {path: read(path) for path in walk(workspace_dir)}
  return create_manifest(files, parent=parent_manifest_id)
```

### 2.3 Active Leaf Tracking

- `chats.active_leaf_message_id` determines current conversation position
- `chats.active_manifest_id` tracks workspace state for that leaf
- When user switches branches or retries, materialize the corresponding manifest

---

## 3. Toolset Bundle Format

### 3.1 ZIP Structure

```
my-toolset.zip
  toolset.yaml          # Required manifest
  tools/                # Python tool modules
    analyze.py
    transform.py
  artifacts/            # HTML templates for renderers
    results.html
  assets/               # Static files tools may need
    templates/
      default.json
```

### 3.2 Manifest Schema (`toolset.yaml`)

```yaml
manifest_version: "1"

id: my-toolset
name: My Toolset
version: "1.0.0"
description: Example toolset with analysis tools

tools:
  - id: analyze_data
    entrypoint: tools.analyze:run
    renderer:
      type: html
      artifact: artifacts/results.html
      data: "$return"

  - id: transform_file
    entrypoint: tools.transform:run
    renderer:
      type: code
      file: "$args.output"
      language: auto
      editable: true

# Canonical overrides (preferred over tools[].renderer)
tool_overrides:
  - tool_id: analyze_data
    renderer: html
    renderer_config:
      artifact: artifacts/results.html
      data: "$return"
  - tool_id: my-mcp-server:search
    name_override: Web Search
    requires_confirmation: false

# Optional: MCP servers to install
mcp_servers:
  - id: my-mcp-server
    command: npx
    args: ["-y", "my-mcp-package"]
    env:
      API_KEY: "${MY_API_KEY}"  # Reference environment variable
```

Notes:
- `tool_overrides` is the canonical override mechanism.
- `tools[].renderer` is a legacy alias for renderer overrides only.

### 3.3 Import Process

1. Validate manifest schema
2. Create `toolsets` row
3. Unpack files to `data/toolsets/<toolset_id>/`
4. Create `toolset_files` rows with hashes
5. Create `tools` rows for each declared tool
6. Create `tool_overrides` rows (including legacy `tools[].renderer`)
7. If `mcp_servers` declared: create `toolset_mcp_servers` rows and reload MCPManager
8. Initialize MCP connections for new servers

### 3.4 Export Process

1. Query `toolsets`, `toolset_files`, `tools`, `tool_overrides`, `toolset_mcp_servers`
2. Regenerate `toolset.yaml` from DB state
3. Pack stored files into ZIP
4. Strip sensitive data (env values become `${VAR}` placeholders)

---

## 4. Python Tool Runtime Contract

### 4.1 Tool Discovery

Tools are discovered by their `entrypoint` in the `tools` table:
- Format: `module.path:function_name`
- Module path is relative to toolset's `tools/` directory

### 4.2 Tool Function Signature

Tools are defined using the `@tool` decorator from `covalt_toolset`. The decorator:
- Infers JSON Schema from type hints (including Pydantic models)
- Captures metadata (name, description, requires_confirmation)
- Makes the function discoverable by the executor

Context (workspace, chat_id, etc.) is accessed via `get_context()` instead of function arguments.

```python
from covalt_toolset import tool, get_context

@tool(
    name="Analyze Data",
    description="Analyze a data file and return statistics",
)
def analyze_data(filename: str) -> dict:
    """
    Args:
        filename: File to analyze
    
    Returns:
        JSON-serializable dict. This becomes $return for renderer interpolation.
    """
    ctx = get_context()  # Access workspace, chat_id, toolset_id
    
    input_file = ctx.workspace / filename
    data = input_file.read_text()
    result = process(data)
    
    output_file = ctx.workspace / "output.json"
    output_file.write_text(json.dumps(result))
    
    return {
        "summary": "Processed 100 rows",
        "output_file": "output.json",
        "stats": {"rows": 100, "columns": 5}
    }
```

For complex input schemas, use Pydantic models:

```python
from pydantic import BaseModel, Field
from covalt_toolset import tool

class TransformConfig(BaseModel):
    input: str = Field(description="Input file path")
    output: str = Field(description="Output file path")
    template: str = Field(description="Template to apply")

@tool(name="Transform File", description="Transform a file using a template")
def transform_file(config: TransformConfig) -> dict:
    ctx = get_context()
    # ... implementation
```

### 4.3 Execution Flow

1. Materialize workspace to latest manifest state
2. Import tool module, get function by entrypoint
3. Extract metadata from `@tool` decorator (schema, name, description)
4. Set context via `set_context()` (workspace, chat_id, toolset_id)
5. Call function with kwargs from tool call args
6. Clear context via `clear_context()`
7. Capture return value (or exception)
8. Snapshot workspace to create new manifest
9. Generate render plan from tool's render config + return value
10. Persist tool_calls row with result and render plan

### 4.4 Error Handling

- Exceptions are caught and stored in `tool_calls.error`
- `tool_calls.status` set to `error`
- Workspace is still snapshotted (partial changes may be useful)
- Render plan can include error display

---

## 5. Renderer System

### 5.1 Renderer Types

| Type | Purpose | Key Config |
|------|---------|------------|
| `code` | Code editor/viewer | `file` or `content`, `language`, `editable` |
| `document` | Markdown/text editor | `file` or `content`, `editable` |
| `html` | HTML template with data | `artifact`, `data` |
| `frame` | Iframe embed | `url` or `port` |

### 5.2 Interpolation

Config values can contain interpolation expressions:

| Expression | Resolves To |
|------------|-------------|
| `$args.{name}` | Tool input argument |
| `$args` | Full args object |
| `$return.{path}` | Nested return value |
| `$return` | Full return object |
| `$chat_id` | Current chat ID |
| `$workspace` | Workspace directory path |
| `$toolset` | Toolset directory path |

### 5.3 Render Plan Generation

After tool execution, generate a render plan:

```python
def generate_render_plan(
    tool_id: str,
    args: dict,
    result: dict,
    context: dict  # chat_id, workspace, toolset paths
) -> dict:
    override = get_tool_override(tool_id)
    return {
        "renderer": override.renderer,
        "config": interpolate(override.renderer_config, args, result, context)
    }
```

Example output:
```json
{
  "renderer": "html",
  "config": {
    "artifact": "/data/toolsets/my-toolset/artifacts/results.html",
    "data": {"summary": "Processed 100 rows", "stats": {"rows": 100}}
  }
}
```

### 5.4 HTML Template Data Injection

For `html` renderer:
1. Load HTML file from `artifact` path
2. Inject data as: `<script>window.__TOOL_DATA__ = ${JSON.stringify(data)};</script>`
3. Insert before `</head>` or at start of `<body>`
4. Render in sandboxed iframe

---

## 6. MCP Integration

### 6.1 Toolset-Declared MCP Servers

Toolsets can declare MCP servers in their manifest. On install:

1. Parse `mcp_servers` section
2. For each server:
   - Create `toolset_mcp_servers` row
   - Set `enabled = true` (auto-enable per spec)
3. Trigger MCPManager reload/reconnect

### 6.2 Environment Variable References

MCP configs can reference environment variables:
- `"${VAR_NAME}"` syntax in config values
- Resolved at runtime from process environment
- On export, values are replaced back with `${VAR}` placeholders

### 6.3 Toolset Uninstall

When uninstalling a toolset:
1. Disconnect and remove MCP servers declared by that toolset
2. Remove `toolset_mcp_servers` rows

---

## 7. API Endpoints

### 7.1 Toolset Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `list_toolsets` | GET | List installed toolsets |
| `get_toolset` | GET | Get toolset details + tools |
| `import_toolset` | POST | Import from ZIP upload |
| `export_toolset` | GET | Export toolset as ZIP |
| `enable_toolset` | POST | Enable/disable toolset |
| `uninstall_toolset` | POST | Remove toolset |

### 7.2 Tool Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `list_tools` | GET | List all tools (builtin + toolset + MCP) |
| `get_tool` | GET | Get tool details + render config |

### 7.3 Workspace Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `get_workspace_files` | GET | List files in chat workspace |
| `get_workspace_file` | GET | Read file content |
| `get_workspace_manifest` | GET | Get manifest for message |

### 7.4 Existing Endpoints (Modified)

- `stream`: Tool execution now includes workspace materialize/snapshot cycle
- `get_available_tools`: Include toolset tools in response

---

## 8. UI Components

### 8.1 Toolset Manager

- List installed toolsets with enable/disable toggles
- Import button (ZIP upload)
- Export button per toolset
- Uninstall button
- View tools provided by each toolset

### 8.2 Tool Picker (Enhanced)

- Group tools by: Builtin | Toolset Name | MCP Server
- Show renderer type indicator per tool
- Show confirmation requirement indicator

### 8.3 Tool Call Renderer

- Receive render plan from tool call result
- Dispatch to appropriate renderer component:
  - `CodeRenderer`: Monaco/CodeMirror with optional edit
  - `DocumentRenderer`: Markdown editor with optional edit
  - `HtmlRenderer`: Sandboxed iframe with injected data
- "Open in workspace" link for file-bound renderers

### 8.4 Workspace Browser

- Tree view of workspace files
- Click to view/download
- Shows which files changed in last tool run

---

## 9. Implementation Milestones

### Milestone 1: Foundation
- [ ] DB schema (toolsets, tools, tool_overrides, workspace_manifests, tool_calls)
- [ ] Workspace CAS implementation (store, materialize, snapshot)
- [ ] Basic toolset import (parse manifest, store files, register tools)

### Milestone 2: Python Tools
- [ ] Tool execution runtime (load module, call function, capture result)
- [ ] Workspace materialize/snapshot integration with tool execution
- [ ] Tool call persistence

### Milestone 3: Renderers
- [ ] Render plan generation with interpolation
- [ ] Code renderer component
- [ ] Document renderer component
- [ ] HTML renderer with data injection

### Milestone 4: Polish
- [ ] Toolset export
- [ ] MCP server auto-add from toolsets
- [ ] Workspace browser UI
- [ ] Toolset manager UI

---

## 10. Example: App Builder Toolset

```yaml
manifest_version: "1"

id: app-builder
name: App Builder
version: "1.0.0"
description: Build and preview web applications

tools:
  - id: write_file
    name: Write File
    description: Write content to a file in the workspace
    entrypoint: tools.files:write_file
    input_schema:
      type: object
      properties:
        path:
          type: string
          description: File path relative to workspace
        content:
          type: string
          description: File content
      required: [path, content]
    renderer:
      type: code
      file: "$args.path"
      language: auto
      editable: true

  - id: read_file
    name: Read File
    description: Read a file from the workspace
    entrypoint: tools.files:read_file
    input_schema:
      type: object
      properties:
        path:
          type: string
      required: [path]
    renderer:
      type: code
      file: "$args.path"
      language: auto

  - id: run_command
    name: Run Command
    description: Run a shell command in the workspace
    entrypoint: tools.shell:run_command
    input_schema:
      type: object
      properties:
        command:
          type: string
      required: [command]
    requires_confirmation: true
    renderer:
      type: code
      content: "$return.output"
      language: shell
```

With `tools/files.py`:
```python
from pathlib import Path

def write_file(workspace: Path, path: str, content: str) -> dict:
    target = workspace / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return {"written": path, "size": len(content)}

def read_file(workspace: Path, path: str) -> dict:
    target = workspace / path
    content = target.read_text()
    return {"path": path, "content": content, "size": len(content)}
```

And `tools/shell.py`:
```python
import subprocess
from pathlib import Path

def run_command(workspace: Path, command: str) -> dict:
    result = subprocess.run(
        command,
        shell=True,
        cwd=workspace,
        capture_output=True,
        text=True
    )
    return {
        "command": command,
        "output": result.stdout + result.stderr,
        "exit_code": result.returncode
    }
```
