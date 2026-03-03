---
name: frontend-worker
description: Implements frontend TypeScript features — plugin definitions, frontend registry, lifecycle hooks, UI refactoring, and tests.
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that primarily involve:
- Frontend TypeScript/React code (app/, nodes/ TypeScript files)
- Frontend plugin registry and definition loading
- Frontend lifecycle hooks (onNodeCreate, onConnectionValidate, onSocketTypePropagate)
- UI component refactoring (canvas, properties panel, node rendering)
- Frontend tests (vitest)
- May include minor backend Python changes when tightly coupled

## Work Procedure

1. **Read the feature description carefully.** Understand preconditions, expected behavior, and verification steps. Read AGENTS.md for mission boundaries and architecture decisions.

2. **Investigate existing code.** Read all files you'll be modifying. Understand current patterns. Key files:
   - `nodes/_types.ts` (node definition types)
   - `nodes/_registry.ts` (node registration)
   - `app/lib/flow/context.tsx` (flow state management)
   - `app/components/flow/canvas.tsx` (node rendering setup)
   - `app/components/flow/properties-panel.tsx` (node configuration)

3. **Write tests FIRST (red).** Create or update test files following existing patterns:
   - Co-located tests: `app/lib/flow/__tests__/*.test.ts`
   - Use vitest (`describe`, `it`, `expect`)
   - Test rendering, state changes, hook dispatch
   Run tests and confirm they FAIL: `bun run test --run -- --reporter=verbose <test_file>`

4. **Implement the feature (green).** Write minimal code to make tests pass. Follow existing patterns:
   - `"use client"` for client components
   - `interface` for object shapes, `type` for unions
   - `useCallback` for event handlers, `useMemo` for expensive computations
   - `cn()` for conditional classes
   - Keep functions <30 lines
   Run tests and confirm they PASS: `bun run test --run -- --reporter=verbose <test_file>`

5. **Run full test suite.** Ensure no regressions:
   - `bun run test --run`
   - `bun run lint`
   - If backend changes were made: `uv run pytest -x -q --tb=short`

6. **Manual verification.** For each verification step:
   - If it involves UI: use agent-browser to verify visual behavior
   - If it involves grep scans: run the grep and verify results
   - If it involves the node palette: verify nodes appear correctly
   - Record each check in the handoff

7. **Check for hardcoded references.** If your feature involves core decoupling, run:
   ```
   rg -w "chat-start|webhook-trigger|webhook-end|reroute" app/lib/flow/ app/components/flow/ --glob "!*test*"
   ```
   Verify zero hits in core (outside tests).

## Example Handoff

```json
{
  "salientSummary": "Implemented frontend plugin hook system with onNodeCreate and onSocketTypePropagate hooks. Refactored context.tsx to dispatch onNodeCreate instead of hardcoding webhook-trigger hookId generation. Refactored reroute _socketType propagation to use onSocketTypePropagate hook. 8 tests added, all passing.",
  "whatWasImplemented": "Created app/lib/flow/plugin-hooks.ts with typed hook registry (registerHook/dispatchHook). Updated nodes/_types.ts with FrontendHookType union. Refactored context.tsx createFlowNode to dispatch onNodeCreate hook. Refactored connection validation to dispatch onSocketTypePropagate for pass-through nodes. Added 8 vitest tests.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "bun run test --run -- --reporter=verbose app/lib/flow/__tests__/plugin-hooks.test.ts", "exitCode": 0, "observation": "8 tests passed" },
      { "command": "bun run test --run", "exitCode": 0, "observation": "All core suites pass (7 pre-existing failures in n8n plugin unchanged)" },
      { "command": "rg -w 'webhook-trigger|reroute' app/lib/flow/context.tsx", "exitCode": 1, "observation": "Zero hardcoded refs in context.tsx" },
      { "command": "bun run lint", "exitCode": 0, "observation": "Lint passed" }
    ],
    "interactiveChecks": [
      { "action": "Opened flow editor with agent-browser, added webhook-trigger node", "observed": "Node created with hookId auto-populated via plugin hook — no hardcoded logic in context.tsx" },
      { "action": "Connected reroute node between two typed sockets", "observed": "Socket type propagated correctly through reroute via hook system" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "app/lib/flow/__tests__/plugin-hooks.test.ts",
        "cases": [
          { "name": "registers and dispatches onNodeCreate hook", "verifies": "Hook fires on node creation" },
          { "name": "onSocketTypePropagate propagates type through pass-through nodes", "verifies": "Socket type propagation via hook" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on backend API changes that aren't in scope
- A core component has changed in ways the feature description didn't anticipate
- Existing tests fail in ways unrelated to the feature
- Requirements are ambiguous or contradictory
- The feature scope is significantly larger than described
