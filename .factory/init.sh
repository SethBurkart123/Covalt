#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Install JS dependencies (idempotent)
bun install --frozen-lockfile 2>/dev/null || bun install

# Install Python dependencies (idempotent)
uv sync 2>/dev/null || true

echo "Environment ready."
