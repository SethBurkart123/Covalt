---
name: ci-gate-worker
description: Implements fail-closed CI gate wiring and local/CI command parity for lint, vitest, pytest, and Playwright.
---

# CI Gate Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features in Milestone C that:
- Split required checks into distinct CI gate identities
- Ensure fail-closed behavior for every required layer
- Align local command matrix with CI semantics
- Produce final required-check and stability evidence

## Work Procedure

1. Read feature requirements and mission boundaries.
2. Update scripts/workflows/manifests so required layers are explicit and distinct:
   - lint
   - vitest (run mode)
   - pytest
   - playwright
3. Ensure no masking patterns in required paths (`continue-on-error`, `|| true`, conditional success wrappers).
4. Align local commands and CI commands semantically (same layer intent and environment assumptions).
5. Verify end-state with full-stack runs and collect final confidence evidence with immutable same-SHA remote proof:
   - Identify the exact implementation SHA under validation and ensure it is remotely resolvable before querying check-runs (push a temporary evidence ref if required for historical SHAs).
   - Query remote check-runs for that exact SHA and capture immutable run identities for each required context (`lint`, `vitest`, `pytest`, `playwright`) using run ID + URL.
   - In the final evidence artifact, include required-context cross-validation fields that map required contexts to same-SHA run identities (for example `requiredContextCrossValidation.contextToRunIdentity`) and explicit verification booleans in assessment fields (for example `branchProtectionAssessment.requiredContextMappingVerified`, `allRequiredContextsMappedToSameShaRuns`, `allMappedRunsHaveImmutableIdentity`).
   - Do not mark gate evidence complete unless all required contexts are mapped to completed/successful same-SHA runs with immutable IDs/URLs.
6. If branch protection/ruleset update is needed but blocked by permissions, return with concrete blocker and exact next step for user.

## Example Handoff

```json
{
  "salientSummary": "Split CI into distinct fail-closed required layers and aligned local command matrix. Full stack lint/vitest/pytest/playwright passes non-vacuously on the same revision.",
  "whatWasImplemented": "Updated workflow jobs and package scripts to expose and run each required layer independently, removed failure masking paths, aligned services manifest command matrix, and added final evidence artifact for repeated full-stack stability runs.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run lint",
        "exitCode": 0,
        "observation": "Lint gate green"
      },
      {
        "command": "bun run test --run",
        "exitCode": 0,
        "observation": "Vitest gate green with non-zero tests"
      },
      {
        "command": "uv run pytest -q",
        "exitCode": 0,
        "observation": "Pytest gate green with non-zero tests"
      },
      {
        "command": "npx playwright test",
        "exitCode": 0,
        "observation": "Playwright gate green with non-zero tests"
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required check identity constraints cannot be satisfied with current CI/provider capabilities
- Branch protection/ruleset changes are blocked by missing permissions
- External infrastructure dependencies block required gate validation
- Conflicting repository policy requires a product/owner decision
