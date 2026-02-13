from pathlib import Path
import os
import sys

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
from .services.http_routes import register_http_routes
from . import commands  # noqa: F401


def main() -> int:
    init_database()
    rebuild_node_route_index()

    output_dir = Path(__file__).parent.parent / "app" / "python"
    app = Bridge(
        generate_ts=str(output_dir / "api.ts"),
        port=8000,
        debug=False,
        app_init="backend.services.http_routes:register_http_routes",
        reload_includes=["backend"],
    )
    register_http_routes(app.app)
    app.on_shutdown(shutdown_mcp)

    app.run(dev=True)
    return 0
