"""Node executor auto-discovery.

Scans nodes/**/executor.py, imports each, registers by node_type.
Drop a folder with executor.py, restart, it appears.
"""

from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# node_type -> executor instance
EXECUTORS: dict[str, Any] = {}


def _discover() -> None:
    """Walk nodes/**/executor.py and register each executor."""
    root = Path(__file__).parent

    for executor_path in root.rglob("executor.py"):
        # Build the module path: nodes.core.agent.executor -> relative to project root
        relative = executor_path.relative_to(root.parent)
        module_path = str(relative.with_suffix("")).replace("/", ".").replace("\\", ".")

        try:
            module = importlib.import_module(module_path)
            executor = getattr(module, "executor", None)

            if executor is None:
                logger.warning(f"nodes: {module_path} has no 'executor' export")
                continue

            node_type = getattr(executor, "node_type", None)
            if node_type is None:
                logger.warning(f"nodes: {module_path} executor has no 'node_type'")
                continue

            EXECUTORS[node_type] = executor
            logger.debug(f"nodes: registered '{node_type}' from {module_path}")

        except Exception as e:
            logger.error(f"nodes: failed to load {module_path}: {e}")


_discover()


def get_executor(node_type: str) -> Any | None:
    return EXECUTORS.get(node_type)


def list_node_types() -> list[str]:
    return list(EXECUTORS.keys())
