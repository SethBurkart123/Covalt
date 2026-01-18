# Remaining Features - Tool System PRD

This document tracks features from the original PRD that have not yet been implemented.

---

## 1. Docker & Container Runtime

**Status:** Not implemented

The PRD envisions Docker-based MCP servers with full container lifecycle management. This enables powerful use cases like sandboxed code execution, Computer Use/VNC, and isolated development environments.

### Missing Components

**Docker MCP Server Support**
- Config format for Docker-based servers:
  ```yaml
  mcp:
    puppeteer:
      image: mcp/puppeteer
      
    desktop:
      image: ghcr.io/anthropics/computer-use
      workspace: true  # Mount chat workspace
      ports: [6080]
  ```
- Pull and run Docker images as MCP servers
- Environment variable injection (credentials)
- Workspace volume mounting (`workspace: true`)
- Port mapping and exposure

**Container Lifecycle Management**
- Lazy container startup (on first tool call)
- Idle timeout and automatic cleanup
- Per-chat vs shared container modes
- Container state persistence across app restarts
- Graceful shutdown on chat close/app exit

**`frame` Renderer**
- Render iframe pointing to container service URL
- Config: `render: frame` with `url` or `port`
  ```yaml
  tools:
    preview_app:
      render: frame
      url: http://localhost:$return.port
      
    computer:
      render: frame
      port: 6080  # noVNC
  ```
- Dynamic port interpolation from tool return values

### Use Cases Blocked

- Computer Use / VNC desktop
- Live app preview (dev servers)
- Sandboxed code execution environments
- Database containers with GUI tools

---

## 2. Editable Artifacts

**Status:** Implemented

The config layer supports `editable: true` and the UI now provides full editing capabilities with real-time file synchronization.

### Implemented Features

**Editable Code Renderer** ✅
- Monaco editor integration with full editing support
- Auto-save with debounce (1 second delay)
- Write changes back to workspace file via `updateWorkspaceFile` API
- Save status indicator (Synced / Unsaved / Saving / Saved / Error)
- Cmd+S force save support

**File Sync** ✅
- Centralized file state management in `artifact-panel-context.tsx`
- Real-time WebSocket notifications when workspace files change
- Automatic content refresh when LLM tools modify open files
- Deleted file detection with read-only warning state

### Remaining Features

**Editable Document Renderer**
- Rich text / Markdown editor (currently read-only)
- Save to workspace file
- Support for `file` or `content` source

### Config Supported

```yaml
tools:
  write_file:
    render: code
    file: $args.path
    language: auto
    editable: true  # UI now respects this flag
```

### Architecture

The file sync system follows a VSCode-like model:

1. **Single source of truth**: `artifact-panel-context.tsx` maintains a `Map<filePath, FileState>` for all open files
2. **Backend notifications**: After tool execution, `toolset_executor.py` compares manifests and broadcasts `workspace_files_changed` events via WebSocket
3. **Frontend sync**: The artifact context subscribes to these events and refetches any open files that changed
4. **Auto-save**: `EditableCodeViewer` uses debounced saves through the context's `saveFile()` method

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│  Backend            │ ─────────────────► │  Frontend           │
│  (tool execution)   │  workspace_files   │  (artifact context) │
│                     │  _changed event    │                     │
└─────────────────────┘                    └─────────────────────┘
         │                                          │
         │ diff_manifests()                         │ refetch open files
         ▼                                          ▼
┌─────────────────────┐                    ┌─────────────────────┐
│  Workspace          │                    │  EditableCodeViewer │
│  (filesystem)       │ ◄──── saveFile ─── │  (Monaco editor)    │
└─────────────────────┘                    └─────────────────────┘
```

---

## 3. Artifact Runtime API (`window.ai`)

**Status:** Not implemented

Custom HTML artifacts need a JavaScript API to interact with the application. Currently only `window.__TOOL_DATA__` injection exists.

### Proposed API: `window.ai`

```javascript
// Workspace file access
await window.ai.workspace.read(path)      // Returns file content
await window.ai.workspace.write(path, content)
await window.ai.workspace.list(dir)       // List directory
window.ai.workspace.watch(path, callback) // File change notifications

// User actions
window.ai.download(path)   // Trigger browser download from workspace
window.ai.upload()         // File picker -> workspace, returns path

// Interaction (send data back to app)
window.ai.interact(data)   // Send data to model or handler
```

### Interaction Handlers

Config can specify what happens when artifact calls `interact()`:

```yaml
tools:
  create_quiz:
    render: html
    artifact: ./quiz.html
    data: $return
    on_interact: grade_quiz  # Call this tool with interaction data
```

**Options:**
- Route to another tool (by tool ID)
- Inject as context for model response
- Custom handler function

### Security Considerations

- CSP policy for sandboxed iframes
- API permission scoping (read-only vs read-write)
- Path traversal prevention in workspace access

---

## 4. Toolset Distribution

**Status:** Partially implemented

ZIP import/export and local directory import work. Missing external discovery and URL-based import.

### Missing Components

**Import from URL**
- Fetch toolset ZIP from HTTPS URL
- Validate and install
- Store source URL for updates

**Toolset Marketplace/Browser**
- Discovery UI for community toolsets
- Categories and search
- Install/update from registry
- Version checking

**Toolset Updates**
- Check for newer versions (when `source_ref` is URL)
- Diff and update workflow
- Preserve user customizations

---

## 5. Advanced Tool Authoring

**Status:** Basic Python tools work

Power features for tool developers.

### Missing Components

**In-App Tool Editor**
- Edit Python tool code directly in the app
- Syntax highlighting with LSP support
- Hot reload on save
- Integrated with workspace browser

**Tool Decorator Enhancements**
- Compile `@tool` decorated functions to MCP format
- Auto-generate input schemas from type hints
- Async tool support improvements

---

## 6. Multi-Model Tool Routing

**Status:** Not implemented

Route different tools to different models for cost optimization or capability matching.

### Concept

```yaml
routing:
  # Cheap model for simple tools
  - tools: [read_file, list_files, search]
    model: gpt-4o-mini
    
  # Expensive model for complex reasoning
  - tools: [analyze_code, refactor]
    model: claude-sonnet
    
  # Default
  - tools: ["*"]
    model: $default
```

### Considerations

- Tool execution may require different model than conversation
- Parallel tool execution across models
- Cost tracking per model

---

## 7. Team & Collaboration

**Status:** Not implemented

Multi-user features for teams.

### Missing Components

- Shared toolset library (team-wide)
- Shared workspaces (optional, for pair programming)
- Tool approval workflows (require admin approval for dangerous tools)
- Usage analytics and audit logs

---

## Implementation Priority

| Priority | Feature Group | Effort | Impact | Status |
|----------|---------------|--------|--------|--------|
| **P0** | Docker & Container Runtime | High | Enables Computer Use, live preview, sandboxed execution | Not started |
| ~~**P1**~~ | ~~Editable Artifacts~~ | ~~Medium~~ | ~~Core editing workflow~~ | **Done** |
| **P1** | `window.ai` API | Medium | Interactive artifacts | Not started |
| **P2** | Toolset Distribution (URL import) | Low | Easier sharing | Not started |
| **P3** | In-App Tool Editor | Medium | Developer experience | Not started |
| **P4** | Multi-Model Routing | Medium | Cost optimization | Not started |
| **P5** | Team Features | High | Enterprise use cases | Not started |
