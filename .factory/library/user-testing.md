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

## Flow Validator Guidance: CLI Contract Validation
- Surface: repository-level command and artifact validation for milestone assertions.
- Use only assigned data namespace when creating temp artifacts/files (if needed).
- Do not modify production code or business logic during validation.
- Prefer read-only checks of mission artifacts and deterministic command reruns.
- Keep runs isolated: do not reuse another flow validator’s temp paths or report file.
- Write exactly one JSON report to the assigned flow path.
- Treat pre-existing mission constraints (ports 3100/3101, no Docker) as hard boundaries.
- If a check is blocked by setup/environment, mark assertion as blocked with explicit root cause evidence.
