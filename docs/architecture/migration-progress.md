# Covalt Desktop — Migration Progress

_Tracks progress through the [Redesign Blueprint](../../docs/architecture/redesign-blueprint.md) phases._

## Current Phase: Phase 4 (Plugin Maturity) — Active Step: Step 3.1 (Provider visibility + store UX stability)

### Phase 0, Step 1: Extract Conversation Run Service -- DONE

**Status:** Complete
**Files changed:** `backend/services/conversation_run_service.py` (new), `backend/commands/streaming.py`, `backend/commands/branches.py`

Extracted four shared patterns into `conversation_run_service.py`:

| Pattern | Function | Call sites consolidated |
|---|---|---|
| Model validation | `validate_model_options()` | 5 (3 branches + 2 streaming) |
| Message history reconstruction | `build_message_history()` | 3 (all in branches) |
| Event emission | `emit_run_start_events()` | 4 (3 branches + 1 streaming) |
| Streaming error handling | `handle_streaming_run_error()` | 2 (both in streaming) |

Size impact:
- `streaming.py`: 775 -> 705 LOC (-70)
- `branches.py`: 625 -> 522 LOC (-103)
- `conversation_run_service.py`: 159 LOC (new)

### Phase 0, Step 2: Split use-chat-input into Focused Hooks -- DONE

**Status:** Complete  
**Files changed:**
- `app/lib/hooks/use-chat-input.ts` (refactored orchestrator)
- `app/lib/hooks/use-chat-snapshot.ts` (new)
- `app/lib/hooks/use-chat-stream-actions.ts` (new)
- `app/lib/hooks/use-chat-branch-edit-actions.ts` (new)
- `app/lib/hooks/use-chat-input.types.ts` (new)

Extracted chat input responsibilities into focused modules:

| Concern | Location |
|---|---|
| Snapshot loading/reload + prefetch guards | `use-chat-snapshot.ts` |
| Stream submission/continue/retry/stop | `use-chat-stream-actions.ts` |
| Edit + sibling navigation actions | `use-chat-branch-edit-actions.ts` |
| Shared hook contracts | `use-chat-input.types.ts` |
| Composition/orchestration | `use-chat-input.ts` |

Size impact:
- `use-chat-input.ts`: 563 -> 202 LOC (-361)
- New extracted modules: +721 LOC across 4 files
- Net: +360 LOC for this area (decomposition for separation of concerns, behavior preserved)

---

### Phase 0, Step 3: Add max-lines Lint Guardrail -- DONE

**Status:** Complete  
**Files changed:** `eslint.config.mjs`

Added project-wide warning rule:
- `max-lines`: warn at >500 LOC (ignores blank lines/comments)
- Explicitly disabled for generated `app/python/api.ts`

Verification:
- `bun run lint` passes (warnings only; now surfaces oversized files)
- `bun run test` passes (173/173)
- `uv run pytest` passes (244 passed, 43 skipped)

---

### Phase 1, Step 1: Provider Manifest System -- DONE

**Status:** Complete
**Files changed:** 81 provider files deleted, 4 new files added

Replaced 81 identical OpenAI-compatible provider modules with a modular adapter system:

| Component | File | Purpose |
|---|---|---|
| Adapter registry | `backend/providers/adapters/__init__.py` | Contract + registry for adapter modules |
| OpenAI adapter | `backend/providers/adapters/openai_compatible.py` | Factory for OpenAI-compatible providers |
| Manifest | `backend/providers/_manifest.py` | Declarative list of 81 provider configs |
| Credential fix | `backend/providers/__init__.py` | Added `provider_name` param to bypass stack inspection |

Size impact:
- Deleted 81 files (~4,400 LOC)
- Added 4 files (~200 LOC)
- Net reduction: ~4,200 LOC

All 244 tests pass (43 skipped). 12 new adapter tests added.

25 custom provider modules remain as code (Anthropic, Google, Copilot, Ollama, Groq, etc.).

Adding a new OpenAI-compatible provider is now a single line in `_manifest.py`. Adding a new protocol family (e.g. Anthropic-compatible) means adding one adapter file in `adapters/`.

---

### Phase 2, Step 1: Runtime Event Contract Hardening -- DONE

**Status:** Complete  
**Files changed:**
- `backend/services/runtime_events.py` (new)
- `backend/services/chat_graph_runner.py`
- `backend/commands/streaming.py`
- `backend/services/conversation_run_service.py`
- `backend/commands/branches.py`
- `app/lib/services/runtime-events.ts` (new)
- `app/lib/services/stream-processor.ts`
- `app/lib/services/api.ts`
- `app/contexts/streaming-context.tsx`
- `app/contexts/flow-execution-context.tsx`
- `app/lib/services/runtime-events.test.ts` (new)
- `tests/test_runtime_events.py` (new)

Introduced a canonical runtime event contract on backend/frontend and routed core runtime emit/consume paths through shared constants and helpers to reduce string drift and tighten protocol handling.

Key outcomes:
- Backend now emits most chat runtime events via `emit_chat_event()` and validates known event names (with explicit `allow_unknown=True` for passthrough agent/custom events).
- Frontend stream processing now uses shared runtime event constants and ignores/logs unknown runtime events safely once.
- Flow/stream contexts use shared runtime event classifiers for tool/member/flow-node routing.

Verification:
- `bun run lint` (warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (176 passed)
- `uv run pytest tests` (248 passed, 43 skipped)

---

### Phase 2, Steps 2-3: Stream Processor Decomposition + Validation Enforcement -- DONE

**Status:** Complete  
**Files changed:**
- `app/lib/services/stream-processor.ts` (refactored to thin dispatcher)
- `app/lib/services/stream-processor-state.ts` (new)
- `app/lib/services/stream-processor-utils.ts` (new)
- `app/lib/services/text-stream-handler.ts` (new)
- `app/lib/services/tool-event-handler.ts` (new)
- `app/lib/services/member-run-handler.ts` (new)
- `app/lib/services/flow-node-handler.ts` (new)
- `app/lib/services/stream-processor.test.ts` (new)
- `backend/services/runtime_events.py`
- `tests/test_runtime_events.py`

Split frontend stream processing into event-family modules and kept `stream-processor.ts` as a focused orchestrator/dispatcher. Added characterization tests for text/tool/member/flow-node event families plus unknown event passthrough behavior.

Key outcomes:
- `processEvent()` now emits all runtime events (known + unknown) through `callbacks.onEvent` so flow execution observers no longer depend on duplicated ad-hoc parsing paths.
- Unknown frontend runtime events are still fail-safe (warn once + passthrough to observers, no reducer mutation).
- Backend runtime event validation is now strict for unknown events unless `allow_unknown=True` is explicitly set.
- Runtime event constants now include `ToolCallFailed` and `ToolCallError` on backend to match shared frontend contract classifiers.

Size impact:
- `stream-processor.ts`: 748 -> 238 LOC (-510)
- New focused handler/state/util modules: +703 LOC across 6 files
- Net: +193 LOC for this area (intentional decomposition to reduce monolithic orchestration risk)

Verification:
- `bun run lint` (warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (250 passed, 43 skipped)

---

### Phase 1, Step 2: Backend-Served Provider Catalog -- DONE

**Status:** Complete  
**Commit:** `fce1aa4`  
**Files changed:**
- `backend/services/provider_catalog.py` (new)
- `backend/models/chat.py`
- `backend/commands/system.py`
- `backend/db/providers.py`
- `backend/db/__init__.py`
- `app/lib/types/provider-catalog.ts` (new)
- `app/lib/services/provider-catalog.ts` (new)
- `app/(app)/(pages)/settings/providers/provider-icons.ts` (new)
- `app/(app)/(pages)/settings/providers/provider-registry.ts` (new dynamic accessor)
- `app/(app)/(pages)/settings/providers/ProvidersPanel.tsx`
- `app/components/ModelSelector.tsx`
- `app/(app)/(pages)/settings/ModelChipSelector.tsx`
- `app/(app)/(pages)/settings/providers/ProviderItem.tsx`
- `app/python/api.ts` (regenerated)
- `app/(app)/(pages)/settings/providers/ProviderRegistry.ts` (deleted)

Replaced the static frontend provider registry with a backend-served provider catalog and migrated provider consumers to dynamic metadata.

Follow-up fixes included in the same phase:
- Reset provider catalog promise cache on rejection to avoid poisoned retries.
- Added missing provider icon aliases/mappings for backend icon IDs.
- Canonicalized provider keys in `get_provider_overview` for settings/OAuth consistency.

Verification:
- `bun run lint` (warnings only)
- `bun run test` (173 passed)
- `bun x tsc --noEmit` (passed)
- `uv run pytest` (244 passed, 43 skipped)

---

### Phase 3, Step 1: Extract start_run Use-case + Thin stream_chat Adapter -- DONE

**Status:** Complete  
**Files changed:**
- `backend/application/__init__.py` (new)
- `backend/application/conversation/__init__.py` (new)
- `backend/application/conversation/start_run.py` (new)
- `backend/commands/streaming.py`

Moved stream-chat orchestration into a conversation application use-case and rewired `stream_chat` to a transport-focused adapter that maps request DTO -> use-case input.

Key outcomes:
- Added `execute_start_run()` as the Phase 3 `start_run` use-case with explicit injected dependencies for validation, persistence, event emission, runtime delegation, and error handling.
- `stream_chat` now delegates runtime orchestration through `_build_start_run_dependencies()` + `StartRunInput`.
- Preserved existing runtime/event behavior (including attachment staging, message persistence, run-start events, and graph runtime invocation).

Size impact:
- `backend/commands/streaming.py`: 737 -> 725 LOC (-12)
- `backend/application/conversation/start_run.py`: +135 LOC (new)

Verification:
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 3, Step 2 (`continue_run`)** in `backend/commands/branches.py`.

---

### Phase 3, Step 2: Extract continue_run Use-case + Thin continue_message Adapter -- DONE

**Status:** Complete  
**Files changed:**
- `backend/application/conversation/__init__.py`
- `backend/application/conversation/continue_run.py` (new)
- `backend/commands/branches.py`

Moved `continue_message` orchestration into a dedicated conversation use-case and rewired command handler to transport mapping + delegation.

Key outcomes:
- Added `execute_continue_run()` with explicit dependency injection for validation, branch message lifecycle, event emission, runtime invocation, and failure reporting.
- `continue_message` is now a thin adapter constructing `ContinueRunInput` and delegating to the use-case.
- Preserved current runtime behavior: existing block recovery, trailing error-block stripping, branch materialization, event order (`RunStarted` -> `AssistantMessageId`), and graph runtime delegation shape.

Size impact:
- `backend/commands/branches.py`: 529 -> 517 LOC (-12)
- `backend/application/conversation/continue_run.py`: +142 LOC (new)

Verification:
- `uv run pytest tests/test_branch_graph_routing.py tests/test_branch_runtime_characterization.py` (6 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 3, Step 3 (`retry_run`)**.

---

### Phase 3, Step 3: Extract retry_run Use-case + Thin retry_message Adapter -- DONE

**Status:** Complete  
**Files changed:**
- `backend/application/conversation/__init__.py`
- `backend/application/conversation/retry_run.py` (new)
- `backend/commands/branches.py`

Moved `retry_message` orchestration into a dedicated conversation use-case and rewired command handler to transport mapping + delegation.

Key outcomes:
- Added `execute_retry_run()` with explicit dependency injection for validation, branch message lifecycle, event emission, runtime invocation, and failure reporting.
- `retry_message` is now a thin adapter constructing `RetryRunInput` and delegating to the use-case.
- Preserved current runtime behavior: parent-branch materialization semantics, event order (`RunStarted` -> `AssistantMessageId`), and graph runtime delegation shape.

Size impact:
- `backend/commands/branches.py`: 517 -> 506 LOC (-11)
- `backend/application/conversation/retry_run.py`: +110 LOC (new)

Verification:
- `uv run pytest tests/test_branch_graph_routing.py tests/test_branch_runtime_characterization.py` (6 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 3, Step 4 (`edit_user_message_run`)**.

---

### Phase 3, Step 4: Extract edit_user_message_run Use-case + Thin edit_user_message Adapter -- DONE

**Status:** Complete  
**Files changed:**
- `backend/application/conversation/__init__.py`
- `backend/application/conversation/edit_user_message_run.py` (new)
- `backend/commands/branches.py`

Moved `edit_user_message` orchestration into a dedicated conversation use-case and rewired command handler to transport mapping + delegation.

Key outcomes:
- Added `execute_edit_user_message_run()` with explicit dependency injection for validation, attachment handling, workspace updates, branch lifecycle, event emission, runtime invocation, and failure reporting.
- `edit_user_message` is now a thin adapter that maps request payloads into use-case DTOs and delegates execution.
- Preserved current runtime behavior: existing/new attachment handling, file rename propagation, branch materialization, event order (`RunStarted` -> `AssistantMessageId`), and graph runtime delegation shape.

Size impact:
- `backend/commands/branches.py`: 506 -> 470 LOC (-36)
- `backend/application/conversation/edit_user_message_run.py`: +261 LOC (new)

Verification:
- `uv run pytest tests/test_branch_graph_routing.py tests/test_branch_runtime_characterization.py` (6 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 3, Step 5 (tooling boundaries)**.

---

### Phase 3, Step 5: Extract Tooling Run-Control Use-cases + Thin streaming Tooling Adapters -- DONE

**Status:** Complete  
**Files changed:**
- `backend/application/tooling/__init__.py` (new)
- `backend/application/tooling/run_control_use_cases.py` (new)
- `backend/commands/streaming.py`

Moved tooling run-control command logic into application-layer use-cases and rewired command handlers to transport mapping + delegation.

Key outcomes:
- Added `execute_respond_to_tool_approval()`, `execute_cancel_run()`, and `execute_cancel_flow_run()` with injected dependencies for `run_control`/DB interactions.
- Rewired `respond_to_tool_approval`, `cancel_run`, and `cancel_flow_run` command handlers to thin adapters with DTO mapping.
- Preserved cancellation and approval behavior, including early-cancel intent handling and mark-message-complete flow.

Size impact:
- `backend/commands/streaming.py`: 725 -> 714 LOC (-11)
- `backend/application/tooling/run_control_use_cases.py`: +163 LOC (new)

Verification:
- `uv run pytest tests/test_stream_run_control_commands.py` (6 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 3, Step 6 (consolidation cleanup)**.

---

### Phase 3, Step 6: Consolidation Cleanup for Thin Command Adapters -- DONE

**Status:** Complete  
**Files changed:**
- `backend/commands/streaming.py`
- `backend/commands/branches.py`

Applied non-behavioral cleanup after use-case extraction to reduce adapter duplication and normalize helper wiring.

Key outcomes:
- Introduced shared helper wrappers in command modules for graph-data lookup and error-block append wiring, removing repeated inline lambdas.
- Kept command handlers transport-focused while preserving existing runtime/event contracts.
- Finalized Phase 3 command-adapter shape for migrated conversation/tooling paths.

Size impact:
- `backend/commands/streaming.py`: 714 -> 718 LOC (+4, helper normalization)
- `backend/commands/branches.py`: 470 -> 464 LOC (-6)

Verification:
- `uv run pytest tests/test_streaming_graph_routing.py tests/test_branch_graph_routing.py tests/test_branch_runtime_characterization.py tests/test_stream_run_control_commands.py` (17 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (251 passed, 43 skipped)

Follow-up:
- Phase 3 slice (conversation + tooling boundaries) is complete. Next logical phase is **Phase 4 (plugin maturity)**.

---

### Phase 4, Steps 1-2: Provider Plugin Loader + Install Lifecycle (Code Plugins) -- DONE

**Status:** Complete  
**Files changed:**
- `backend/services/provider_plugin_manager.py` (new)
- `backend/providers/__init__.py`
- `backend/commands/provider_plugins.py` (new)
- `backend/commands/__init__.py`
- `backend/services/provider_catalog.py`
- `backend/models/chat.py`
- `app/python/api.ts` (regenerated)
- `tests/test_provider_plugin_manager.py` (new)
- `tests/test_provider_plugin_runtime.py` (new)

Added a provider plugin manager + runtime loader with support for full code-based provider plugins (manifest `entrypoint` modules) and adapter-backed plugins.

Key outcomes:
- Added provider plugin package support (`provider.yaml`) with schema validation, zip/directory import, safe archive path normalization, enable/disable state, and uninstall lifecycle.
- Implemented code-plugin runtime loading into provider registry via isolated dynamic module namespace and `reload_provider_registry()`.
- Added new provider plugin commands: `list_provider_plugins`, `import_provider_plugin`, `import_provider_plugin_from_directory`, `enable_provider_plugin`, `uninstall_provider_plugin`.
- Integrated plugin providers into backend-served provider catalog output.
- Added uninstall safety guard requiring provider disable before plugin removal.

Size impact:
- `backend/providers/__init__.py`: 220 -> 402 LOC (+182)
- `backend/services/provider_catalog.py`: 319 -> 345 LOC (+26)
- New modules/tests added for plugin manager, commands, and characterization coverage.

Verification:
- `uv run pytest tests/test_provider_plugin_manager.py tests/test_provider_plugin_runtime.py tests/test_openai_compatible_adapter.py tests/test_provider_model_options_mapping.py tests/test_anthropic_oauth_provider.py tests/test_openai_codex_provider.py` (43 passed)
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (254 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 4, Step 3 (Store UI + source index integration)**.

---

### Phase 4, Step 3: Provider Store UI + Source Index + Sample Plugins -- DONE

**Status:** Complete  
**Files changed:**
- `app/(app)/(pages)/settings/providers/ProviderStorePanel.tsx` (new)
- `app/(app)/(pages)/settings/providers/ProvidersPanel.tsx`
- `backend/commands/provider_plugins.py`
- `backend/models/chat.py`
- `app/python/api.ts` (regenerated)
- `examples/provider-plugins/sample-openai-adapter/provider.yaml` (new)
- `examples/provider-plugins/sample-code-provider/provider.yaml` (new)
- `examples/provider-plugins/sample-code-provider/plugin.py` (new)
- `tests/test_provider_plugin_sources_command.py` (new)

Implemented the provider store UX and backend source index for installable community plugin templates.

Key outcomes:
- Added Store panel under Provider settings to browse source-index entries, install source plugins, upload plugin ZIPs, enable/disable installed plugins, and uninstall plugins.
- Added backend source index commands: `list_provider_plugin_sources`, `install_provider_plugin_source`.
- Added curated sample provider plugins (adapter-based and full code-entrypoint) under `examples/provider-plugins/*` so community contributors have concrete templates.
- Extended API contracts and regenerated TS client for new source-index command/types.

Size impact:
- New store UI panel and source index flow added without changing existing provider config behavior.
- Added sample plugin directories for reference implementations.

Verification:
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (181 passed)
- `uv run pytest tests` (256 passed, 43 skipped)

Follow-up:
- Next active step is **Phase 4, Step 4 (optional plugin signing/trust model hardening)**.

---

### Phase 4, Step 3.1: Provider Visibility + Store UX Stability Fixes -- DONE

**Status:** Complete  
**Files changed:**
- `backend/services/provider_catalog.py`
- `backend/commands/provider_plugins.py`
- `app/lib/services/provider-catalog.ts`
- `app/(app)/(pages)/settings/providers/ProvidersPanel.tsx`
- `app/(app)/(pages)/settings/providers/ProviderStorePanel.tsx`
- `app/(app)/(pages)/settings/providers/ProviderItem.tsx`
- `app/python/api.ts` (regenerated)
- `tests/test_provider_plugin_sources_command.py`
- `tests/test_provider_catalog.py` (new)
- `app/lib/services/provider-catalog.test.ts` (new)

Fixed provider disappearance regression and aligned Provider Store UX with product expectations.

Key outcomes:
- Fixed backend runtime error path (`_build_fallback_entry` missing) that could collapse provider catalog responses.
- Ensured installed plugin providers are visible in main Providers immediately while staying **disabled by default**.
- Hardened provider catalog client fetch behavior to recover cleanly after transient failures (no poisoned in-flight promise state).
- Moved Provider Store access to a **plus button beside provider search** and rendered Store inside a modal.
- Removed enable/disable actions from Store installed list; keep uninstall in Store and use main provider card for enable/disable.
- Added warning indicator/badge behavior for plugin issues while keeping other providers visible.

Size impact:
- Targeted stability/UX fixes; no broad architecture reshuffle.

Verification:
- `bun run lint` (passes; warnings only)
- `bun x tsc --noEmit` (passed)
- `bun run test` (182 passed)
- `uv run pytest tests` (257 passed, 43 skipped)

Follow-up:
- Next active step remains **Phase 4, Step 4 (optional plugin signing/trust model hardening)**.

---

## Phase Overview

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Quick wins, low risk | Complete |
| **Phase 1** | Footprint reduction (provider manifests + catalog unification) | Complete |
| **Phase 2** | Event protocol hardening | Complete |
| **Phase 3** | Core boundaries (application-layer services) | Complete |
| **Phase 4** | Plugin maturity | In Progress (Steps 1-3 complete) |
