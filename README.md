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

## Plugin System
Covalt uses a unified plugin architecture for flow nodes:
- **Frontend registry** for node definitions, components, and editor lifecycle hooks
- **Backend registry** for executors and runtime lifecycle hooks
- **Unified plugin API** used by both built-in nodes and externally installed plugins

Built-in node types are now registered through the plugin API, and external plugins can be installed from GitHub repositories or zip packages via the node-provider install/import flows.

To create your own plugin, see: [`docs/creating-plugins.md`](docs/creating-plugins.md)

## Project Structure
Key plugin-related paths:
- `nodes/` — built-in plugin manifests, node definitions, and executors
- `backend/services/plugin_registry.py` — backend plugin registration and hook dispatch
- `app/lib/flow/plugin-registry.ts` — frontend plugin registration and definition lookup
- `docs/creating-plugins.md` — plugin authoring and packaging guide

## Contributing
- Run quality checks before PRs.
- Keep fixes at root cause level (avoid symptom-only workarounds).
- Keep functions small, explicit, and composable.

## Status
Active development; breaking changes are expected before initial release.
