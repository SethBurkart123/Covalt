# Workspace File Sync Implementation

This document describes the real-time file synchronization system for editable artifacts.

## Problem Statement

When users opened editable artifacts, the following bug occurred:

1. LLM creates a file via `write_file` tool
2. User edits the file in the artifact editor
3. User asks LLM about the file contents (LLM correctly sees updated content via `read_file`)
4. User opens the `read_file` result as a read-only artifact
5. **Bug**: When switching back to the editable artifact, contents reverted to the original

### Root Cause

Each `CodeArtifact` component had its own `useWorkspaceFile` hook that fetched file content independently on mount. The `write_file` artifact's hook held stale data from when it first mounted, while the `read_file` artifact fetched fresh data. When clicking back on the `write_file` artifact, it used its stale hook state.

## Solution: Centralized File State Management

We implemented a VSCode-like architecture where:

1. **The workspace filesystem is the single source of truth**
2. **A centralized context manages all open file state**
3. **WebSocket notifications sync frontend when files change**

## Implementation Details

### Backend Changes

#### 1. WebSocket Event (`backend/commands/events.py`)

Added `WorkspaceFilesChanged` event type:

```python
class WorkspaceFilesChanged(BaseModel):
    chat_id: str
    changed_paths: List[str]
    deleted_paths: List[str]
```

And broadcast function:

```python
async def broadcast_workspace_files_changed(
    chat_id: str,
    changed_paths: list[str],
    deleted_paths: list[str],
) -> None:
    # Sends to all connected WebSocket clients
```

#### 2. Manifest Diffing (`backend/services/workspace_manager.py`)

Added method to compare two workspace manifests:

```python
def diff_manifests(
    self,
    pre_manifest_id: str | None,
    post_manifest_id: str | None,
) -> tuple[list[str], list[str]]:
    """Returns (changed_paths, deleted_paths)"""
```

#### 3. Event Emission (`backend/services/toolset_executor.py`)

After tool execution creates a post-manifest, we diff and broadcast:

```python
if pre_manifest_id or post_manifest_id:
    changed_paths, deleted_paths = workspace_manager.diff_manifests(
        pre_manifest_id, post_manifest_id
    )
    if changed_paths or deleted_paths:
        asyncio.create_task(
            broadcast_workspace_files_changed(chat_id, changed_paths, deleted_paths)
        )
```

### Frontend Changes

#### 1. WebSocket Callback (`app/contexts/websocket-context.tsx`)

Added callback registration for workspace file changes:

```typescript
onWorkspaceFilesChanged: (
  callback: (chatId: string, changedPaths: string[], deletedPaths: string[]) => void
) => () => void;
```

#### 2. Centralized File State (`app/contexts/artifact-panel-context.tsx`)

Extended the artifact panel context with file management:

```typescript
interface FileState {
  content: string;
  isLoading: boolean;
  isDeleted: boolean;
  version: number;
}

// New methods
openFile: (filePath: string) => void;
closeFile: (filePath: string) => void;
getFileState: (filePath: string) => FileState | undefined;
saveFile: (filePath: string, content: string) => Promise<void>;
```

The context:
- Maintains a `Map<string, FileState>` for all open files
- Subscribes to `workspace_files_changed` events
- Refetches content when files are externally modified
- Marks files as deleted when removed from workspace

#### 3. Updated Artifact Components

**CodeArtifact.tsx** and **MarkdownArtifact.tsx**:
- Removed `useWorkspaceFile` hook
- Now use `openFile()` and `getFileState()` from context
- Pass `filePath` to `open()` for file tracking

**EditableCodeViewer.tsx**:
- Reads content directly from context via `getFileState()`
- Uses `saveFile()` from context for auto-save
- Content updates automatically when WebSocket events arrive
- Shows "Deleted" warning when file is removed

#### 4. Cleanup

- Removed `app/hooks/use-workspace-file.ts` (no longer needed)

## Data Flow

### Opening an Artifact

```
User clicks artifact
        │
        ▼
openFile(filePath) ──► Add to openFiles map with isLoading: true
        │
        ▼
fetchFileContent() ──► GET /api/workspace/file
        │
        ▼
Update openFiles map with content, isLoading: false
        │
        ▼
EditableCodeViewer reads from getFileState()
```

### User Editing

```
User types in editor
        │
        ▼
handleChange() ──► Show "Unsaved" status
        │
        ▼
debouncedSave() (1s delay)
        │
        ▼
saveFile(path, content) ──► Update context + POST /api/workspace/file
        │
        ▼
Show "Saved" status
```

### LLM Modifies File

```
Tool execution completes
        │
        ▼
workspace_manager.snapshot() ──► Creates post_manifest
        │
        ▼
diff_manifests(pre, post) ──► Find changed files
        │
        ▼
broadcast_workspace_files_changed() ──► WebSocket event
        │
        ▼
Frontend receives event
        │
        ▼
For each open file in changedPaths:
        │
        ▼
fetchFileContent() ──► Refetch from backend
        │
        ▼
Update openFiles map (bumps version)
        │
        ▼
Editor re-renders with new content
```

## Design Decisions

1. **No conflict resolution**: User edits are overwritten by LLM changes. This is acceptable because auto-save is frequent (1s debounce), so user changes are typically saved before LLM writes.

2. **Stale-while-revalidate**: When opening an already-cached file, we show cached content immediately and refetch in background. This avoids loading delays.

3. **Per-chat file state**: File state is scoped to the current chat and cleared when switching chats.

4. **File closed with artifact**: When an artifact is removed, its associated file is closed (unless another artifact is using it).

## Files Changed

| File | Changes |
|------|---------|
| `backend/commands/events.py` | Added `WorkspaceFilesChanged` event + broadcast function |
| `backend/services/workspace_manager.py` | Added `diff_manifests()` method |
| `backend/services/toolset_executor.py` | Emit event after tool execution |
| `app/contexts/websocket-context.tsx` | Added `onWorkspaceFilesChanged` callback |
| `app/contexts/artifact-panel-context.tsx` | Added file state management |
| `app/components/tool-renderers/CodeArtifact.tsx` | Use context instead of hook |
| `app/components/tool-renderers/EditableCodeViewer.tsx` | Read/write via context |
| `app/components/tool-renderers/MarkdownArtifact.tsx` | Use context instead of hook |
| `app/hooks/use-workspace-file.ts` | **Deleted** |
