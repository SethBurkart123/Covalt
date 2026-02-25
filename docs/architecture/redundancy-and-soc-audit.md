# Redundancy and Separation-of-Concerns Audit

This audit focuses on large-scale duplication and boundary violations that increase maintenance cost.

## Highest-Impact Duplication Hotspots

| # | Duplication | Evidence | Why It Hurts | Unification Target |
| --- | --- | --- | --- | --- |
| 1 | OpenAI-compatible provider boilerplate across many backend providers | `backend/providers/*.py` and `backend/providers/openai_like.py` | Bug fixes and auth behavior drift across dozens of files | Descriptor-driven provider factory + shared OpenAI-like adapters |
| 2 | Provider metadata duplicated between frontend and backend | `app/(app)/(pages)/settings/providers/ProviderRegistry.ts` vs `backend/providers/*.py` | UI and runtime can disagree on defaults/capabilities | Backend-served provider manifest; frontend becomes rendering-only |
| 3 | Parallel chat streaming orchestration paths | `backend/commands/streaming.py` (`stream_chat`, `stream_agent_chat`) + `backend/commands/branches.py` | Retry/edit/continue semantics diverge and regress independently | Shared `ChatRunService` with mode-specific adapters |
| 4 | Tool execution/render fallback spread across multiple modules | `backend/services/tool_registry.py`, `backend/services/toolset_executor.py`, `backend/services/chat_graph_runner.py` | Render plans and metadata can diverge by path | Single `RenderPlanBuilder` and tool descriptor contract |
| 5 | Two OAuth stacks with overlapping mechanics | `backend/services/oauth_manager.py`, `backend/services/provider_oauth_manager.py` | Security-sensitive logic duplicated, hard to patch confidently | Shared OAuth engine + storage adapters |
| 6 | Two WebSocket clients in frontend | `app/python/api.ts` (`EventsSocket`) and `app/contexts/websocket-context.tsx` | Reconnect, event parsing, and payload typing duplicated | Standardize on generated socket client + context wrapper |
| 7 | Duplicate theme systems | `app/contexts/theme-context.tsx` and `app/lib/theme-provider.tsx` | Inconsistent API contracts and stale UI components | Remove legacy provider; keep one theme context API |
| 8 | Artifact file fetch/decode logic in multiple places | `app/contexts/artifact-panel-context.tsx`, `app/components/WorkspaceBrowser.tsx` | Workspace file behavior inconsistent (loading/errors/cache) | Shared `workspace-file-repository` + hook |
| 9 | Parallel chat input engines | `app/lib/hooks/use-chat-input.ts`, `app/lib/hooks/use-test-chat-input.ts` | Behavior mismatch between prod chat and agent-test chat | Shared chat runtime state machine hook |
| 10 | Sidebar tab patterns repeated | `settings/SettingsSidebar.tsx`, `toolsets/ToolsetsSidebar.tsx` | Duplicate view-model and layout behavior | Reusable section sidebar component |
| 11 | Agent metadata forms repeated | `agents/CreateAgentDialog.tsx`, `agents/edit/AgentSettingsDialog.tsx` | Validation and field drift | Shared `AgentMetadataForm` |
| 12 | Event translation logic repeated in backend transport paths | `backend/commands/streaming.py`, `backend/services/http_routes.py`, `backend/services/chat_graph_runner.py` | Different event payloads by endpoint; fragile protocol | Central event translator module |
| 13 | Edge/channel validation split across runtime modules | `backend/services/graph_runtime.py`, `flow_executor.py`, `graph_normalizer.py` | Different fail modes for same graph defects | Canonical graph validator package |
| 14 | Message content parsing logic repeated | `backend/services/chat_graph_runner.py`, `backend/db/chats.py`, `backend/commands/branches.py` | Legacy shape handling duplicated everywhere | Canonical message content codec |
| 15 | Tool node executors mirror each other | `nodes/tools/toolset/executor.py`, `nodes/tools/mcp_server/executor.py` | Similar orchestration logic in two branches | Shared base executor for tool source nodes |
| 16 | Import-time registration patterns repeated | `backend/main.py`, `backend/commands/__init__.py`, `nodes/_registry.py`, `backend/providers/__init__.py` | Startup side effects obscure boundaries and order dependencies | Explicit registrar/bootstrap phase |
| 17 | Model settings loaded in multiple frontend paths | `app/components/ChatPanel.tsx`, `settings/ModelSettingsPanel.tsx` | Cache invalidation and prompt behavior divergence | Shared `model-settings` domain module |
| 18 | Debounced settings save patterns duplicated | `settings/SystemPromptPanel.tsx`, `settings/AutoTitlePanel.tsx` | Subtle timing/flush differences | Shared `useDebouncedRemoteSetting` hook |
| 19 | OAuth polling patterns duplicated in frontend | `settings/providers/ProvidersPanel.tsx`, `components/ToolSelector.tsx`, `components/mcp/server-card.tsx` | Inconsistent retries and pending-state UX | Shared `useOauthPolling` hook/service |
| 20 | Legacy + canonical schema shapes coexisting for tool render config | `backend/services/toolset_manager.py`, `docs/toolset-system-spec.md` | Migration never truly ends; edge bugs remain | Canonicalize on `tool_overrides` only |

## Separation-of-Concerns Violations

### Backend

- Service->command dependency (`backend/services/toolset_executor.py` imports `backend/commands/events.py`)
- DB->service dependency (`backend/db/chats.py` imports workspace manager)
- Side-effect driven system boot (`backend/main.py`, `backend/commands/__init__.py`, `nodes/_registry.py`)

### Frontend

- UI components with network/storage orchestration (`ChatInputForm.tsx`, `server-form-dialog.tsx`)
- Contexts directly coupling to transport and UI internals (`artifact-panel-context.tsx` uses `getWorkspaceFile` and `useSidebar`)
- Feature pages owning protocol logic (`ProvidersPanel.tsx` handles oauth state machines)

## Canonicalization Targets

Standardize these concepts to one runtime shape each:

1. Tool presentation config -> only `tool_overrides` (drop legacy `tools[].renderer` runtime reads)
2. Theme state API -> one provider/hook contract
3. WebSocket events -> one client transport implementation
4. Message content format -> one codec and storage representation
5. Tool/provider catalog metadata -> backend is source of truth; frontend only renders

## Quick Wins (Low Risk, High Return)

1. Merge theme providers and delete legacy toggle paths
2. Introduce shared `useOauthPolling`
3. Extract shared workspace file repository for artifact + browser views
4. Create shared chat-stream hook core and adapt test-chat path
5. Replace static frontend provider catalog with backend manifest response

These quick wins reduce duplicate moving parts before deeper runtime refactors.
