# ruff: noqa: E402
import logging
import os
from pathlib import Path
from typing import Any

from zynk import Bridge
from zynk.codegen import generate_client
import zynk.generators.effect  # noqa: F401  registers the "effect" generator

import nodes
from backend.services.plugins.plugin_registry import _DEFAULT_PLUGIN_REGISTRY

nodes.init(_DEFAULT_PLUGIN_REGISTRY)

from . import commands  # noqa: F401
from .db import init_database
from .services.flows.http_routes import register_http_routes
from .services.node_providers.node_provider_registry import reload_node_provider_registry
from .services.node_providers.node_route_index import rebuild_node_route_index
from .services.renderers.registry import register_builtin_renderers
from .services.tools.mcp_manager import shutdown_mcp
from .services.tools.toolset_manager import get_toolset_manager
from .services.variables.builtin_loaders import register_builtin_loaders

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
    reload_node_provider_registry()
    register_builtin_loaders()
    register_builtin_renderers()

    repo_root = Path(__file__).parent.parent
    output_dir = repo_root / "app" / "python"
    dev_mode = os.environ.get("COVALT_DEV_MODE") == "1"
    generate_ts = os.environ.get("COVALT_GENERATE_TS") == "1"
    port = int(os.environ.get("COVALT_BACKEND_PORT", "8000"))
    if generate_ts:
        generate_client(
            str(output_dir / "api.ts"),
            language="effect",
            options={
                "default": "effect",
                "commands": "promise",
                "uploads": "promise",
                "statics": "promise",
            },
        )
        logger.info(f"✓ Effect client generated: {output_dir / 'api.ts'}")

    bridge_kwargs: dict[str, Any] = {
        "port": port,
        "debug": False,
        "app_init": "backend.services.flows.http_routes:register_http_routes",
        "reload_dirs": [str(repo_root / "backend")],
        "reload_excludes": [
            str(repo_root / ".next"),
            str(repo_root / "out"),
            str(repo_root / "build"),
            str(repo_root / "dist"),
            str(repo_root / "app" / "python"),
            str(repo_root / "db"),
        ],
    }
    app = Bridge(**bridge_kwargs)
    register_http_routes(app.app)
    app.on_shutdown(shutdown_mcp)

    app.run(dev=dev_mode)
    return 0
