# AGENTS.md - Guidelines for AI Coding Agents

## Project Overview

This is **Agno Desktop**, an Electron/Web Hybrid (can be built as a desktop app or a web app) AI chat application built with Next.js 15, React 19, TypeScript, and a Python (FastAPI) backend via the zynk library available at `./zynk`. It features an artifact panel system for displaying code, markdown, and HTML with real-time file sync via WebSocket.

## Build & Development Commands

```bash
bun run dev            # Start full development environment (frontend + backend)
bun run dev:frontend   # Start only frontend (Next.js with Turbopack)
bun run backend        # Start only backend (Python/FastAPI)
bun run build          # Build for production
bun run lint           # Run linting
```

### Important Notes
- The API client (`app/python/api.ts`) is **auto-generated** when the dev server runs - NEVER edit manually!
- Backend uses `uv` for Python package management
- Frontend uses `bun` as the package manager

### Regenerating TypeScript Types
If you need to regenerate the TypeScript API client types without running the full dev server:
```bash
timeout 2 uv run main.py || true
```
This works even if it crashes due to port conflicts - the type generation happens before the server binds to ports.

## Project Structure

```
app/
├── (app)/              # Next.js app router pages
│   └── (pages)/        # Nested page routes (settings, tools, etc.)
├── components/         # React components
│   ├── ui/             # Reusable UI primitives (shadcn/ui style)
│   └── tool-renderers/ # Artifact rendering components
├── contexts/           # React context providers
├── hooks/              # Custom React hooks
├── lib/                # Utilities, types, and services
│   ├── hooks/          # Domain-specific hooks
│   ├── services/       # API and stream processing
│   ├── types/          # TypeScript type definitions
│   └── tool-renderers/ # Tool renderer registry
└── python/             # Auto-generated Python API client
```

## Code Style Guidelines

### Philosophy: The Tinygrad Way

This codebase values **clarity, composability, and satisfaction**. Take inspiration from tinygrad:

- **Small, focused functions** that do ONE thing really well
- **No over-abstraction** - if you can't explain it in one sentence, it's too complex
- **Composable building blocks** - functions that snap together like LEGO
- **Aim for <30 lines per function** - break giant functions into readable chunks

### Critical Debugging Principle

**Always fix the root cause, not the symptom.**

- Solve issues at their source, not downstream where they manifest
- Don't add workarounds that mask the real problem
- Understand WHY before fixing WHERE

### Conventions

- Use explicit types for function parameters and return values
- Prefer `interface` for object shapes, `type` for unions and aliases
- Destructure props in component signatures
- Use `"use client"` directive for client components
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Use refs for values that shouldn't trigger re-renders
- Context pattern: create context, provider, and hook together in one file
- Use try-catch with `console.error` logging and guard clauses for early returns
- Use `cn()` from `@/lib/utils` for conditional classes, `cva()` for variants

### Naming Conventions

- **Components**: PascalCase (`EditableCodeViewer`, `ChatPanel`)
- **Hooks**: camelCase with `use` prefix (`useArtifactPanel`, `useModels`)
- **Utilities**: camelCase (`cn`, `addRecentModel`, `getFileState`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RECENT_MODELS`, `TRANSITION`)
- **Files**: kebab-case for components (`artifact-panel-context.tsx`)
- **Clear names**: `ensureChatInitialized()` beats `initChatStuff()`

## ESLint Configuration

Key rules (warnings, not errors):
- `@typescript-eslint/no-unused-vars`: warn
- `@typescript-eslint/no-explicit-any`: warn  
- `react-hooks/rules-of-hooks`: warn
- `react/no-unescaped-entities`: warn

The `app/python/api.ts` file has relaxed rules (auto-generated).

## Backwards Compatibility

**No backwards compatibility is guaranteed until initial release.** Breaking changes may occur during development. This includes:

- Toolset YAML schema changes
- API changes  
- Database schema changes
- Python SDK changes

## The Golden Rule

**If it feels messy, it probably is!** Refactor with joy. Future you will high-five present you.

Code is read WAY more than it's written - make it a pleasure to read.
