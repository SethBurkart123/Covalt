# Covalt Desktop

> [!WARNING]
> This project is a work in progress. It is not yet ready for production use.

## Quick Start
Prerequisites:
- Bun
- Python `3.12+`
- `uv`

Install dependencies:
```bash
bun install
```

Start dev mode:
```bash
bun run dev
```

## Validation Commands
Run required merge-confidence checks locally:
```bash
bun run ci:full
```

Run layers individually:
```bash
bun run ci:lint
bun run ci:vitest
bun run ci:pytest
bun run ci:playwright
```

## Contributing
- Run quality checks before PRs.
- Keep fixes at root cause level (avoid symptom-only workarounds).
- Keep functions small, explicit, and composable.

## Status
Active development; breaking changes are expected before initial release.
