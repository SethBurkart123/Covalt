# Covalt Desktop

> [!WARNING]
> This project is a work in progress. It is not yet ready for production use.

An Electron/Web hybrid AI chat application built with Next.js 15, React 19, TypeScript, and a Python (FastAPI) backend. Features an artifact panel system for displaying code, markdown, and HTML with real-time file sync via WebSocket, a visual agent flow editor, and MCP OAuth support.

## Quick Start

Prerequisites:
- [Bun](https://bun.sh)
- Python `3.12+`
- [`uv`](https://docs.astral.sh/uv/)

Install dependencies:
```bash
bun install
```

Start dev mode:
```bash
bun run dev
```

## Dev Commands

```bash
bun run dev             # Start full dev environment (frontend + backend)
bun run dev:frontend    # Start only frontend (Next.js with Turbopack)
bun run backend         # Start only backend (Python/FastAPI)
bun run build           # Build for production
bun run lint            # Run linting
```

> **Note:** `app/python/api.ts` is **auto-generated** (never edit it manually). It regenerates whenever the dev server starts.
>
> To regenerate types without running the full dev server:
> ```bash
> COVALT_GENERATE_TS=1 timeout 2 uv run main.py
> ```

## Project Structure

```
covalt-desktop/
├── src/bun/index.ts          # Electrobun shell entry point
├── app/                      # Next.js frontend
│   ├── components/           # UI components
│   ├── contexts/             # React context providers
│   ├── lib/                  # Services, hooks, types
│   ├── oauth/callback/       # MCP OAuth callback page
│   └── python/               # Auto-generated API bridge client (api.ts)
├── backend/                  # Python/FastAPI backend
│   ├── main.py               # Backend entry point
│   ├── config.py             # Data directory resolution
│   ├── commands/             # Zynk @command modules
│   ├── services/             # Business logic services
│   ├── providers/            # AI provider integrations
│   └── database/             # SQLAlchemy models and migrations
├── nodes/                    # Built-in plugin manifests and node definitions
├── covalt-toolset/           # Built-in toolset package
├── docs/                     # Developer documentation
├── tests/                    # Python (pytest) and frontend (vitest) tests
├── contracts/                # Shared type contracts
├── scripts/                  # Dev and build scripts
├── package.json              # JS dependencies
├── pyproject.toml            # Python dependencies (managed by uv)
└── electrobun.config.ts      # Electrobun app metadata and build config
```

## Plugin System

Covalt uses a unified plugin architecture for flow nodes:

- **Frontend registry** for node definitions, components, and editor lifecycle hooks
- **Backend registry** for executors and runtime lifecycle hooks
- **Unified plugin API** shared by both built-in nodes and external plugins

External plugins can be installed from GitHub repositories or zip packages via the node-provider install/import flows.

To create your own plugin, see: [`docs/creating-plugins.md`](docs/creating-plugins.md)

Key plugin paths:
- `nodes/` (built-in plugin manifests, node definitions, and executors)
- `backend/services/plugin_registry.py` (backend plugin registration and hook dispatch)
- `app/lib/flow/plugin-registry.ts` (frontend plugin registration and definition lookup)

## Validation

Run all checks locally before merging:
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

- Contributors must sign a [CLA](CONTRIBUTING.md) before PRs can be merged.
- Run quality checks before PRs.
- Fix issues at the root cause, not downstream where they manifest.
- Keep functions small (aim for <30 lines), explicit, and composable.

## Status

Active development. Breaking changes are expected before initial release. No backwards compatibility is guaranteed for toolset schemas, APIs, database schemas, or the Python SDK.

## License

Covalt is licensed under the [GNU Affero General Public License v3.0](LICENSE).

The Covalt name and branding are trademarked (see [TRADEMARKS.md](TRADEMARKS.md)).
Commercial licensing is available (see [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md)).

