from pathlib import Path
import logging
import os
import sys
from typing import Any

_local_zynk = Path(__file__).parent.parent / "zynk"
sys.path.insert(0, str(_local_zynk))
existing_pythonpath = os.environ.get("PYTHONPATH", "")
paths = [str(_local_zynk)] + ([existing_pythonpath] if existing_pythonpath else [])
os.environ["PYTHONPATH"] = os.pathsep.join([p for p in paths if p])

import nodes  # noqa: F401

from zynk import Bridge

from .db import init_database
from .services.mcp_manager import shutdown_mcp
from .services.node_route_index import rebuild_node_route_index
from .services.toolset_manager import get_toolset_manager
from .services.http_routes import register_http_routes
from . import commands  # noqa: F401

logger = logging.getLogger(__name__)


def _ensure_e2e_toolset() -> None:
    if os.environ.get("COVALT_E2E_TESTS") != "1":
        return
    manager = get_toolset_manager()
    if manager.get_toolset("artifact-tools"):
        return
    toolset_dir = Path(__file__).parent.parent / "examples" / "artifact-tools-toolset"
    if not toolset_dir.exists():
        logger.warning(f"E2E toolset directory missing: {toolset_dir}")
        return
    manager.import_from_directory(toolset_dir)


def main() -> int:
    init_database()
    _ensure_e2e_toolset()
    rebuild_node_route_index()

    output_dir = Path(__file__).parent.parent / "app" / "python"
    dev_mode = os.environ.get("COVALT_DEV_MODE") == "1"
    generate_ts = os.environ.get("COVALT_GENERATE_TS") == "1"
    port = int(os.environ.get("COVALT_BACKEND_PORT", "8000"))
    bridge_kwargs: dict[str, Any] = {
        "generate_ts": str(output_dir / "api.ts") if generate_ts else None,
        "port": port,
        "debug": False,
        "app_init": "backend.services.http_routes:register_http_routes",
        "reload_includes": ["backend"],
        "reload_excludes": [
            ".next",
            "out",
            "build",
            "dist",
            "app/python",
        ],
    }
    app = Bridge(**bridge_kwargs)
    register_http_routes(app.app)
    app.on_shutdown(shutdown_mcp)

    app.run(dev=dev_mode)
    return 0
