# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually test the application, entry points, tools, known UI quirks.

---

## Testing Surface (Mission)

### Frontend (browser / agent-browser / Playwright)
- URL: `http://127.0.0.1:3101`
- Expected title baseline: `Covalt`
- Core mission flows:
  1. Artifact render appears in UI after tool execution
  2. Approval-required run supports approve and deny paths
  3. Persisted content remains after reload/navigation

### Backend (curl)
- Reachability endpoint: `http://127.0.0.1:3100/`
- OpenAPI endpoint: `http://127.0.0.1:3100/openapi.json`
- Note: `/health` may not exist; use root/openapi reachability for readiness in this repo.

## Tools
- `agent-browser` for interactive/manual checks
- `curl` for backend surface checks
- `npx playwright` for automated browser flow verification

## Setup Steps
1. Start backend on 3100 and frontend on 3101 (see `.factory/services.yaml`).
2. Verify reachability with curl:
   - `curl -sf http://127.0.0.1:3100/`
   - `curl -sf http://127.0.0.1:3101/`
3. For browser automation, ensure Playwright browsers are installed (`npx playwright install chromium`).

## Isolation Notes
- Keep test data/session usage isolated per run where possible.
- Avoid relying on unrelated local services.

## Known Quirks
- Legacy custom Bun e2e path (`tests/e2e/toolset-suite.ts`) is noisy/failing and should not be used as required mission gate after Playwright migration.
- After the e2e tool-resolution alignment fix (commit `40cafe75759183a10a5d732320dbfee6fa55cb21`), approval-flow Playwright runs should no longer emit backend `Function e2e_requires_approval not found` / `Function e2e_echo not found` noise during successful flows; treat any recurrence as a regression signal.
- In shared multi-worker sessions, local `bun run ci:playwright`/`bun run ci:full` can fail fast with `http://localhost:3100/ is already used` when ports `3100`/`3101` are occupied. Ensure mission ports are free before rerun-based repeatability checks.

## Flow Validator Guidance: CLI Contract Validation
- Surface: repository-level command and artifact validation for milestone assertions.
- Use only assigned data namespace when creating temp artifacts/files (if needed).
- Do not modify production code or business logic during validation.
- Prefer read-only checks of mission artifacts and deterministic command reruns.
- Keep runs isolated: do not reuse another flow validator’s temp paths or report file.
- Write exactly one JSON report to the assigned flow path.
- Treat pre-existing mission constraints (ports 3100/3101, no Docker) as hard boundaries.
- If a check is blocked by setup/environment, mark assertion as blocked with explicit root cause evidence.

## Flow Validator Guidance: Playwright Browser E2E
- Surface: user-visible browser behavior validated through Playwright tests and generated artifacts.
- Use only assigned credentials and data namespace in prompts/messages when test data is created.
- Run only assertion-scoped tests (prefer `--grep` or targeted spec file) to avoid cross-flow interference.
- Do not run legacy Bun e2e tooling; use Playwright-only commands.
- Keep isolation strict: do not reuse another flow validator’s report path or namespace prefix.
- If service startup is required, keep it within Playwright/webServer flow and ensure clean teardown evidence in logs.
- If blocked, record blocking root cause and exact failing command/output in the flow report.
