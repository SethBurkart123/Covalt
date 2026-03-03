---
name: backend-worker
description: Implements backend Python features — plugin registry, executors, lifecycle hooks, core service refactoring, and tests.
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that primarily involve:
- Backend Python code (backend/, nodes/ Python files)
- Plugin registry and executor registration
- Lifecycle hook system implementation
- Core service refactoring (flow_executor, http_routes, chat_graph_runner, etc.)
- Backend tests (pytest)
- May include minor frontend TypeScript changes when they're tightly coupled to backend changes

## Work Procedure

1. **Read the feature description carefully.** Understand preconditions, expected behavior, and verification steps. Read AGENTS.md for mission boundaries and architecture decisions.

2. **Investigate existing code.** Read all files you'll be modifying. Understand the current patterns before changing anything. Read `nodes/_types.py`, `nodes/_registry.py`, and relevant `backend/services/` files.

3. **Write tests FIRST (red).** Create or update test files in `tests/` following existing patterns (pytest, pytest-asyncio). Tests should cover:
   - Happy path for each expected behavior
   - Error/edge cases mentioned in the feature description
   - Integration with existing systems where applicable
   Run tests and confirm they FAIL: `uv run pytest tests/<your_test_file> -x -v`

4. **Implement the feature (green).** Write the minimal code to make tests pass. Follow existing patterns:
   - Pydantic models for data structures
   - FastAPI for endpoints
   - SQLAlchemy for database models
   - Keep functions <30 lines
   - Use explicit types for parameters and return values
   Run tests and confirm they PASS: `uv run pytest tests/<your_test_file> -x -v`

5. **Run full test suite.** Ensure no regressions:
   - `uv run pytest -x -q --tb=short`
   - If frontend changes were made: `bun run test --run`
   - `bun run lint`

6. **Manual verification.** For each verification step in the feature:
   - If it's a curl command: run it and verify the response
   - If it involves the runtime: verify by examining test output carefully
   - If it involves grep scans: run the grep and verify results
   - Record each check in the handoff

7. **Check for hardcoded references.** If your feature involves core decoupling, run:
   ```
   rg -w "chat-start|webhook-trigger|webhook-end|reroute" backend/services/ --glob "!*test*"
   ```
   Verify zero hits in core (outside tests/comments).

## Example Handoff

```json
{
  "salientSummary": "Implemented backend lifecycle hook registry with onNodeCreate, onRouteExtract, onEntryResolve, onResponseExtract hooks. Refactored chat_graph_runner.py to use onEntryResolve instead of hardcoded 'chat-start' check. 14 tests added, all passing. Grep scan confirms zero hardcoded node-type refs in modified files.",
  "whatWasImplemented": "Created backend/services/plugin_hook_registry.py with typed hook registration (register_hook/dispatch_hook). Updated nodes/_types.py with HookType enum and hook protocol types. Refactored chat_graph_runner.py entry node selection to dispatch through onEntryResolve hook. Added 14 tests covering hook registration, dispatch, isolation, and chat entry resolution.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "uv run pytest tests/test_plugin_hook_registry.py -x -v", "exitCode": 0, "observation": "14 tests passed" },
      { "command": "uv run pytest -x -q --tb=short", "exitCode": 0, "observation": "326 passed, 43 skipped — no regressions" },
      { "command": "rg -w 'chat-start' backend/services/chat_graph_runner.py", "exitCode": 1, "observation": "Zero hits — hardcoded reference removed" },
      { "command": "bun run lint", "exitCode": 0, "observation": "Lint passed with existing warnings only" }
    ],
    "interactiveChecks": [
      { "action": "Verified hook registration API types are correct", "observed": "HookType enum has 6 variants, register_hook accepts typed callable, dispatch_hook returns list of results" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/test_plugin_hook_registry.py",
        "cases": [
          { "name": "test_register_and_dispatch_hook", "verifies": "Basic hook registration and dispatch" },
          { "name": "test_hook_isolation_on_failure", "verifies": "One hook failure doesn't block others" },
          { "name": "test_deregister_hooks_by_plugin", "verifies": "Plugin disable removes all its hooks" },
          { "name": "test_chat_entry_resolve_via_hook", "verifies": "Chat graph runner uses onEntryResolve hook" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on frontend changes that aren't in scope for this feature
- A core service has changed in ways the feature description didn't anticipate
- Existing tests fail in ways unrelated to the feature (infrastructure issue)
- Requirements in the feature description are ambiguous or contradictory
- The feature scope is significantly larger than described
