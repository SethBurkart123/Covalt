# Covalt Desktop — Migration Progress

_Tracks progress through the [Redesign Blueprint](../../docs/architecture/redesign-blueprint.md) phases._

## Current Phase: Phase 0 (Quick Wins, Low Risk)

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

All 232 tests pass (43 skipped). Zero test changes needed.

Note: `init_assistant_msg` and `get_graph_data_for_chat`/`run_graph_chat_runtime` calls remain inline in the command modules. Assistant msg creation differs enough between streaming and branches to not warrant unification yet. Runtime invocation calls stay inline because existing test mocks patch them at the command module level.

### Phase 0, Remaining Steps

- [ ] Split `use-chat-input` into 3-4 focused hooks
- [ ] Add lint rule for max file length warning (>500 LOC)

---

## Phase Overview

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Quick wins, low risk | In Progress |
| **Phase 1** | Footprint reduction (provider manifests) | Not Started |
| **Phase 2** | Event protocol hardening | Not Started |
| **Phase 3** | Core boundaries (application-layer services) | Not Started |
| **Phase 4** | Plugin maturity | Not Started |
