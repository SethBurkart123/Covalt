#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Building Python backend with Nuitka...${NC}"

cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")"
case "$(uname -s)" in
    Darwin*)    PLATFORM="mac";;
    Linux*)     PLATFORM="linux";;
    CYGWIN*|MINGW*|MSYS*) PLATFORM="win";;
    *)          echo -e "${RED}Unknown platform${NC}"; exit 1;;
esac

echo -e "${YELLOW}Platform: $PLATFORM${NC}"

OUTPUT_DIR="backend-dist/$PLATFORM"
mkdir -p "$OUTPUT_DIR"

if [ "$PLATFORM" = "win" ]; then
    BINARY_NAME="backend.exe"
else
    BINARY_NAME="backend"
fi

echo -e "${YELLOW}Output: $OUTPUT_DIR/$BINARY_NAME${NC}"
if [ "$PLATFORM" = "mac" ]; then
    export SDKROOT=$(xcrun --show-sdk-path)
fi

uv run python -m nuitka \
    --standalone \
    --output-filename="$BINARY_NAME" \
    --output-dir="$OUTPUT_DIR" \
    --lto=no \
    \
    --include-package=backend \
    --include-package=zynk \
    --include-package=agno_toolset \
    \
    --include-package=fastapi \
    --include-package=uvicorn \
    \
    --include-package-data=litellm \
    \
    --follow-imports \
    --assume-yes-for-downloads \
    \
    main.py

if [ "$PLATFORM" != "win" ]; then
    chmod +x "$OUTPUT_DIR/$BINARY_NAME"
fi

echo -e "${GREEN}Build complete: $(du -h "$OUTPUT_DIR/$BINARY_NAME" | cut -f1)${NC}"
