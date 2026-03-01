# Covalt Desktop — Architecture Redesign TODO (Execution Document)

_Last updated: 2026-03-01 (Phase 2 pass + tracker update)_

This is the working execution document for the redesign blueprint. It combines:
- project context needed to onboard quickly,
- architecture findings from a full code audit,
- concrete phased TODOs with file targets,
- acceptance/verification checklists for each phase.

Use this doc as the source of truth for implementation sequencing.

---

## 1) Project context (quick onboarding)

## 1.1 Stack
- **Frontend:** Next.js 15, React 19, TypeScript
- **Backend:** Python 3.12, FastAPI/Zynk bridge
- **Desktop shell:** Electrobun
- **DB:** SQLite (SQLAlchemy)
- **Tooling:** Bun (frontend), uv (backend)

## 1.2 Key commands
```bash
bun run dev            # full stack (frontend + backend)
bun run dev:frontend   # frontend only
bun run dev:backend    # backend only
bun run lint           # eslint
bun run test           # vitest
uv run pytest          # backend tests
bun run test:run       # vitest + pytest + e2e
```

## 1.3 Structure map
```text
app/                  # frontend application
backend/              # backend application/services/infra
nodes/                # flow node definitions + python executors
covalt-toolset/       # tool SDK/tooling
docs/                 # architecture + product docs
```

## 1.4 Ground rules (implementation)
- Keep modules small and single-purpose.
- Preserve clear layer boundaries: API/transport -> application/core -> infra.
- Standardize one canonical shape per concept (tool id, event payload, renderer key).
- No new legacy paths while migrating.
- Prefer decomposition + deletion over additive wrappers.

---

## 2) Blueprint objective summary

1. Strong separation of concerns.
2. Plugin-first extensibility (providers/nodes/renderers/tools).
3. Smaller maintenance footprint via deduplication.
4. Faster iteration through stable contracts and testable boundaries.

Target directions:
- Thin command adapters.
- Consolidated conversation run use-cases.
- Tool orchestration split by responsibility.
- Workspace domain split (blob/manifest/diff/materialize).
- Provider metadata and behavior driven by manifests/plugins.
- Shared runtime event contract (single source of truth).
- Frontend domain stores/composable handlers rather than heavy overlapping contexts.

---

## 3) Current-state findings (from repository audit)

## 3.1 What is already aligned
- Provider system has strong plugin/manifests foundation.
- Frontend stream reducer is already split into event-family handlers.
- Backend has meaningful application-layer extraction for conversation/tooling use-cases.
- Frontend provider catalog now largely backend-driven.

## 3.2 Highest-impact gaps
1. **Layer boundary leaks**
   - DB importing service concerns; services importing command-level functions.
2. **Large backend orchestration monoliths**
   - `backend/services/chat_graph_runner.py` remains highly multi-concern.
3. **Workspace domain still mixed**
   - Blob, manifest, diff/materialization, and FS mutations concentrated in shared manager.
4. **Event/type contracts duplicated FE+BE**
   - Runtime event enums/payload assumptions duplicated and drift-prone.
5. **Frontend overlap hotspots**
   - Parallel chat-input paths (prod/test), dual websocket patterns, residual hardcoded provider metadata.
6. **Renderer/node plugin maturity incomplete**
   - Renderer registry remains static in frontend; node UI definition loading not fully plugin-driven.

## 3.3 Evidence anchors (files to inspect first)
- Backend architecture hotspots:
  - `backend/services/chat_graph_runner.py`
  - `backend/services/toolset_executor.py`
  - `backend/services/workspace_manager.py`
  - `backend/services/provider_plugin_manager.py`
  - `backend/services/provider_catalog.py`
  - `backend/db/chats.py`
  - `backend/db/provider_oauth.py`
  - `backend/commands/streaming.py`
- Frontend architecture hotspots:
  - `app/contexts/streaming-context.tsx`
  - `app/contexts/websocket-context.tsx`
  - `app/lib/hooks/use-chat-input.ts`
  - `app/lib/hooks/use-test-chat-input.ts`
  - `app/(app)/(pages)/settings/providers/ProvidersPanel.tsx`
  - `app/lib/services/provider-catalog.ts`
  - `app/lib/services/runtime-events.ts`
  - `app/lib/services/stream-processor.ts`
  - `app/lib/tool-renderers/registry.ts`

---

## 4) Phase plan (execution TODOs)

Each phase includes: objective, concrete tasks, target files, acceptance criteria, and verification commands.

---

## Phase 0 — Boundary correctness + quick wins (low risk)

### Objective
Stop cross-layer leakage and remove easiest duplication risks before deeper refactors.

### TODOs
- [x] Remove DB -> service dependency in branch/workspace paths.
- [x] Remove service -> command dependency in tool execution events.
- [x] Isolate shared crypto helpers away from service internals.
- [x] Remove legacy frontend theme provider usage and converge on one provider.
- [x] Extract provider plugin settings logic from large settings panel component.

### Status
- **Completed** in commit `0870540`.
- Notes: workspace event broadcasting moved to service layer, crypto helpers centralized, provider plugin settings extracted, and theme usage converged in targeted components.

### File targets
- `backend/db/chats.py`
- `backend/services/workspace_manager.py`
- `backend/services/toolset_executor.py`
- `backend/commands/events.py`
- `backend/db/provider_oauth.py`
- `backend/services/oauth_manager.py`
- `app/lib/theme-provider.tsx`
- `app/contexts/theme-context.tsx`
- `app/components/ui/theme-mode-toggle.tsx`
- `app/components/ui/theme-picker.tsx`
- `app/(app)/(pages)/settings/providers/ProvidersPanel.tsx`

### Acceptance criteria
- No import paths that violate layer direction for touched modules.
- Tool execution path uses injected/event interface, not direct command import.
- Only one active theme provider API remains.
- Providers settings panel reduced in orchestration responsibility.

### Verify
```bash
bun run lint
bun run test
uv run pytest
```

---

## Phase 1 — Conversation + event contract unification (medium risk)

### Objective
Finish conversation orchestration split and establish single runtime event contract.

### TODOs
- [x] Move remaining heavy orchestration helpers out of `commands/streaming.py` into application services.
- [x] Extract shared message content codec used by DB/runtime/conversation paths.
- [x] Define single canonical runtime event contract source (versioned).
- [x] Generate/consume FE runtime event types from canonical source.
- [x] Add contract parity tests (BE known events == FE known events).

### Status
- **Completed** in commit `615a284`.
- Notes: added canonical runtime event contract (`contracts/runtime-events.v1.json`), FE generator script, parity tests (FE+BE), and extracted stream-agent/flow use-cases plus shared message codec.

### File targets
- `backend/commands/streaming.py`
- `backend/application/conversation/*`
- `backend/services/conversation_run_service.py`
- `backend/services/runtime_events.py`
- `backend/models/chat.py`
- `backend/services/chat_graph_runner.py`
- `backend/services/http_routes.py`
- `app/lib/services/runtime-events.ts`
- `app/lib/services/stream-processor.ts`
- `app/lib/services/stream-processor*.ts`

### Acceptance criteria
- Streaming command module behaves as thin transport adapter.
- Shared codec module is used across all touched message serialization paths.
- One authoritative event set is used FE+BE.
- Contract drift test exists and passes.

### Verify
```bash
bun run lint
bun run test
uv run pytest
```

---

## Phase 2 — Workspace + tooling decomposition (medium/high risk)

### Objective
Split mixed workspace/tool orchestration concerns into composable services.

### TODOs
- [x] Split `workspace_manager` responsibilities into focused units:
  - Blob store
  - Manifest repository/projection
  - Materializer
  - Diff service
- [x] Centralize render plan generation into one builder used by runtime + tool execution.
- [x] Remove duplicated renderer alias normalization paths.
- [x] Standardize tool/MCP id parse/normalize/format helpers.

### Status
- **Completed (uncommitted in working tree)** via implementation + review/fix loop; final independent review returned PASS.
- Added workspace-focused modules under `backend/services/workspace/*` with `workspace_manager.py` retained as compatibility facade.
- Added canonical render-plan builder (`backend/services/render_plan_builder.py`) reused by tool execution and runtime fallback.
- Added canonical tooling helpers (`backend/models/tooling.py`, `app/lib/tooling.ts`) and migrated key backend/frontend call sites.
- Fixed MCP tester execution to use canonical parsed tool name from tool id (not display label).

### File targets
- `backend/services/workspace_manager.py`
- `backend/commands/toolsets.py`
- `backend/services/toolset_executor.py`
- `backend/services/tool_registry.py`
- `backend/services/mcp_manager.py`
- `backend/db/chats.py`
- `app/components/ChatInputForm.tsx`
- `app/(app)/(pages)/toolsets/InstalledPanel.tsx`
- `app/components/tool-renderers/default/DefaultToolCall.tsx`
- `app/components/mcp/tool-list.tsx`

### Acceptance criteria
- Workspace responsibilities are separated and individually testable.
- Render plan generation has one canonical implementation.
- Tool id parsing/formatting behavior is centralized and reused.
- Legacy renderer alias handling reduced to migration shim or removed.

### Verify
```bash
bun run lint
bun run test
uv run pytest
bun run test:e2e
```

---

## Phase 3 — Provider/plugin footprint reduction (medium/high risk)

### Objective
Reduce provider code footprint and eliminate metadata duplication.

### TODOs
- [ ] Extend adapter strategy for Anthropic-compatible providers (manifest-driven where possible).
- [ ] Consolidate provider metadata source-of-truth (backend catalog -> frontend render).
- [ ] Reduce frontend hardcoded icon/field override sprawl.
- [ ] Unify OAuth core paths where overlap exists.

### File targets
- `backend/providers/adapters/*`
- `backend/providers/_manifest.py`
- `backend/providers/*.py` (anthropic-like duplicates)
- `backend/services/provider_catalog.py`
- `backend/services/provider_oauth_manager.py`
- `backend/services/oauth_manager.py`
- `app/lib/services/provider-catalog.ts`
- `app/(app)/(pages)/settings/providers/provider-icons.ts`

### Acceptance criteria
- Fewer per-provider custom modules with unchanged runtime behavior.
- Provider presentation metadata predominantly backend-driven.
- OAuth flow responsibilities clearly partitioned/shared without duplicate logic.

### Verify
```bash
bun run lint
bun run test
uv run pytest
```

---

## Phase 4 — Plugin maturity completion (higher risk)

### Objective
Complete plugin-first shape for renderers/nodes and finalize UX-contract features.

### TODOs
- [ ] Add renderer manifest/schema validation path (backend boundary validation).
- [ ] Support manifest-keyed/lazy frontend renderer loading.
- [ ] Introduce node plugin metadata loading improvements (definition/runtime/UI coherence).
- [ ] Complete workspace browser “changed in last run” UX alignment.

### File targets
- `backend/services/toolset_manager.py`
- `backend/commands/toolsets.py`
- `app/lib/tool-renderers/registry.ts`
- `app/components/ToolCallRouter.tsx`
- `nodes/_registry.ts`
- `nodes/_registry.py`
- `app/components/WorkspaceBrowser.tsx`
- `app/contexts/websocket-context.tsx`

### Acceptance criteria
- Renderer config is schema-validated before persistence/use.
- Renderer selection/loading no longer requires static-only registry maintenance.
- Node definitions and execution metadata are coherently discoverable.
- Workspace browser can clearly indicate recent tool-run changes.

### Verify
```bash
bun run lint
bun run test
uv run pytest
bun run test:e2e
```

---

## 5) Cross-phase dependency graph

- **Phase 0** should be completed first (boundary hygiene + low-risk removals).
- **Phase 1** depends on Phase 0 for cleaner command/service boundaries.
- **Phase 2** can start partially in parallel with late Phase 1 work, but render plan + event contract changes should be coordinated.
- **Phase 3** should begin after event/type contract stabilizes in Phase 1.
- **Phase 4** should start after provider/tool id/render-plan canonicalization is stable (Phases 2/3).

---

## 6) Work package template (for each implementation PR)

Use this checklist when opening each PR:

- [ ] Scope limited to one phase objective (or one sub-track).
- [ ] Characterization tests added before high-risk refactors.
- [ ] New module boundaries documented in PR description.
- [ ] Duplicate path removed (not left as permanent fallback).
- [ ] Lint/tests all pass locally.
- [ ] No generated API file edited manually (`app/python/api.ts`).
- [ ] Security check: no secrets/log leakage introduced.

Suggested PR structure:
1. Problem and current behavior
2. Boundary/design change
3. Files touched
4. Behavior parity notes
5. Follow-up tasks

---

## 7) Suggested ownership lanes

- **Backend Core lane:** conversation/runtime/events/workspace decomposition.
- **Backend Platform lane:** providers/oauth/plugin manager/catalog.
- **Frontend Core lane:** stream reducer/types/chat input/workspace browser.
- **Frontend Platform lane:** providers settings UX + renderer loading strategy.

Parallelization guidance:
- Run backend event-contract and frontend reducer work in lockstep.
- Keep provider metadata API changes synchronized with provider settings UI updates.

---

## 8) Risk register

1. **Runtime event drift during migration**
   - Mitigation: parity tests + protocol versioning.
2. **Behavior regressions in streaming/branch operations**
   - Mitigation: characterization tests before extraction.
3. **Provider auth regressions**
   - Mitigation: staged migration + adapter-specific integration tests.
4. **Workspace file sync race conditions**
   - Mitigation: explicit event ordering/state transitions in tests.
5. **Long-lived compatibility shims becoming permanent**
   - Mitigation: time-boxed deprecation tasks with removal dates.

---

## 9) Definition of done (program-level)

Program is complete when all are true:
- [ ] API -> application -> infra boundaries are consistent in touched domains.
- [ ] Conversation and stream command adapters are thin.
- [ ] Event contract is canonical and versioned with FE+BE parity checks.
- [ ] Workspace domain is split into focused services.
- [ ] Tool id + renderer plan behavior is canonicalized.
- [ ] Provider metadata is backend-driven with reduced frontend hardcoding.
- [ ] Renderer/node plugin extensibility no longer depends on large static registries.
- [ ] Test/lint/e2e suites pass across phased merges.

---

## 10) Immediate next actions

1. Commit Phase 2 changes currently in working tree (already PASS-reviewed).
2. Start Phase 3 execution with the same orchestrated loop:
   - implementation subagent
   - independent review subagent
   - fix/re-review until PASS
3. Open/refresh tracking tickets per remaining phase and link PRs/commits back to this document.

---

## Appendix A — Quick audit snapshots

- Major backend bloat by file size includes:
  - `backend/services/chat_graph_runner.py`
  - `backend/services/provider_plugin_manager.py`
  - `backend/services/provider_oauth_manager.py`
  - `backend/services/mcp_manager.py`
- Frontend overlap hotspots include:
  - `use-chat-input.ts` vs `use-test-chat-input.ts`
  - dual websocket patterns
  - heavy provider settings panel responsibilities

Keep these hotspots prioritized for decomposition as part of phase execution.
