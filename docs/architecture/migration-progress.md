# Covalt Desktop — Migration Progress

_Tracks progress through the [Redesign Blueprint](../../docs/architecture/redesign-blueprint.md) phases._

## Current Phase: Phase 1 (Footprint Reduction)

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

## Phase Overview

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Quick wins, low risk | Complete |
| **Phase 1** | Footprint reduction (provider manifests) | In Progress (Step 1 complete) |
| **Phase 2** | Event protocol hardening | Not Started |
| **Phase 3** | Core boundaries (application-layer services) | Not Started |
| **Phase 4** | Plugin maturity | Not Started |
