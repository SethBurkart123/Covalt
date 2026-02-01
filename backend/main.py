import argparse
import sys
from pathlib import Path

from zynk import Bridge

from .db import init_database
from . import commands  # noqa: F401


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Agno Desktop Backend")
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to run the server on (default: 8000)",
    )
    parser.add_argument(
        "--no-generate-ts",
        action="store_true",
        help="Skip TypeScript client generation",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run in development mode with hot-reloading",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    init_database()

    output_dir = Path(__file__).parent.parent / "app" / "python"

    app = Bridge(
        generate_ts=None if args.no_generate_ts else str(output_dir / "api.ts"),
        port=args.port,
        debug=args.dev,
        reload_includes=["backend"],
    )

    # Print ready signal for Electron to detect
    print(f"BACKEND_READY:{args.port}", file=sys.stderr, flush=True)

    app.run(dev=args.dev)
    return 0
