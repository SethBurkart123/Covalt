# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- Python 3.12, managed by uv, venv at `.venv/`
- Node v20 via nvm, bun as package manager
- No external databases or services required for this refactor
- `COVALT_GENERATE_TS=1` env var triggers TypeScript API client generation from Python backend
