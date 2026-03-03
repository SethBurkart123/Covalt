# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- Runtime toolchain:
  - Bun (frontend scripts)
  - Python 3.12 + uv (backend/test tooling)
  - Node/npm available for Playwright CLI (`npx playwright`)
- No Docker dependency for this mission.
- Mission test env variables:
  - `COVALT_BACKEND_PORT=3100`
  - `COVALT_DEV_MODE=1`
  - `PORT=3101` (frontend)
  - Backend generation mode differs by runner:
    - General backend/dev startup uses `COVALT_GENERATE_TS=1`
    - Playwright backend startup uses `COVALT_GENERATE_TS=0` and `COVALT_E2E_TESTS=1`
- If branch protection/ruleset edits are required but unavailable due permissions, escalate to orchestrator/user with exact blocker.
- GitHub check-runs API evidence capture requires the target SHA to be reachable on a remote ref; for historical SHAs, pushing a temporary evidence branch may be required before collecting immutable check-run IDs/URLs.
- Validation evidence artifacts may be scanned by Droid-Shield; timestamp-like fields can trigger push blocking and may require redaction-safe placeholders (for example, `REDACTED`) when raw timestamps are not required for contract proof.
