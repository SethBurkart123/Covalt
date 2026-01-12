"""
Toolset Manager - handles toolset installation, import/export, and registration.

Toolsets are packages containing:
- toolset.yaml manifest
- tools/*.py Python tool modules
- artifacts/ HTML templates for renderers
- assets/ Static files

This manager handles:
- Importing toolsets from ZIP files
- Exporting toolsets to ZIP files
- Registering tools in the database
- Managing toolset lifecycle (enable/disable/uninstall)
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from ..config import get_db_directory
from ..db import db_session
from ..db.models import (
    McpServer,
    Tool,
    Toolset,
    ToolsetFile,
    ToolRenderConfig,
)

logger = logging.getLogger(__name__)

# Manifest schema version we support
SUPPORTED_MANIFEST_VERSIONS = ["1"]


def get_toolsets_directory() -> Path:
    """Get the base directory for installed toolsets."""
    toolsets_dir = get_db_directory() / "toolsets"
    toolsets_dir.mkdir(parents=True, exist_ok=True)
    return toolsets_dir


def get_toolset_directory(toolset_id: str) -> Path:
    """Get the directory for a specific toolset."""
    return get_toolsets_directory() / toolset_id


def _compute_hash(content: bytes) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content).hexdigest()


def _classify_file(path: str) -> str:
    """Classify a file by its path into a kind."""
    if path.startswith("tools/") and path.endswith(".py"):
        return "python"
    if path.startswith("artifacts/"):
        return "artifact"
    if path.startswith("assets/"):
        return "asset"
    if path == "toolset.yaml":
        return "config"
    return "asset"


class ToolsetManifest:
    """Parsed and validated toolset manifest."""

    def __init__(self, data: dict[str, Any]):
        self.raw = data
        self._validate()

    def _validate(self) -> None:
        """Validate manifest structure."""
        # Required fields
        if "id" not in self.raw:
            raise ValueError("Manifest missing required field: id")
        if "name" not in self.raw:
            raise ValueError("Manifest missing required field: name")
        if "version" not in self.raw:
            raise ValueError("Manifest missing required field: version")

        # Check manifest version
        manifest_version = self.raw.get("manifest_version", "1")
        if manifest_version not in SUPPORTED_MANIFEST_VERSIONS:
            raise ValueError(f"Unsupported manifest version: {manifest_version}")

        # Validate tools structure
        for i, tool in enumerate(self.raw.get("tools", [])):
            if "id" not in tool:
                raise ValueError(f"Tool at index {i} missing required field: id")
            if "name" not in tool:
                raise ValueError(f"Tool at index {i} missing required field: name")
            if "entrypoint" not in tool:
                raise ValueError(
                    f"Tool at index {i} missing required field: entrypoint"
                )

    @property
    def id(self) -> str:
        return self.raw["id"]

    @property
    def name(self) -> str:
        return self.raw["name"]

    @property
    def version(self) -> str:
        return self.raw["version"]

    @property
    def description(self) -> str | None:
        return self.raw.get("description")

    @property
    def manifest_version(self) -> str:
        return self.raw.get("manifest_version", "1")

    @property
    def tools(self) -> list[dict[str, Any]]:
        return self.raw.get("tools", [])

    @property
    def mcp_servers(self) -> list[dict[str, Any]]:
        return self.raw.get("mcp_servers", [])


class ToolsetManager:
    """
    Manages toolset installation, export, and lifecycle.

    Usage:
        manager = ToolsetManager()

        # Import from ZIP
        toolset_id = manager.import_from_zip(zip_path)

        # List toolsets
        toolsets = manager.list_toolsets()

        # Export to ZIP
        zip_bytes = manager.export_to_zip(toolset_id)

        # Uninstall
        manager.uninstall(toolset_id)
    """

    def __init__(self) -> None:
        self.toolsets_dir = get_toolsets_directory()

    def list_toolsets(self) -> list[dict[str, Any]]:
        """List all installed toolsets."""
        with db_session() as session:
            toolsets = session.query(Toolset).all()
            return [
                {
                    "id": t.id,
                    "name": t.name,
                    "version": t.version,
                    "description": t.description,
                    "enabled": t.enabled,
                    "installed_at": t.installed_at,
                    "source_type": t.source_type,
                }
                for t in toolsets
            ]

    def get_toolset(self, toolset_id: str) -> dict[str, Any] | None:
        """Get toolset details including tools."""
        with db_session() as session:
            toolset = session.query(Toolset).filter(Toolset.id == toolset_id).first()
            if toolset is None:
                return None

            tools = session.query(Tool).filter(Tool.toolset_id == toolset_id).all()

            return {
                "id": toolset.id,
                "name": toolset.name,
                "version": toolset.version,
                "description": toolset.description,
                "enabled": toolset.enabled,
                "installed_at": toolset.installed_at,
                "source_type": toolset.source_type,
                "source_ref": toolset.source_ref,
                "tools": [
                    {
                        "tool_id": t.tool_id,
                        "name": t.name,
                        "description": t.description,
                        "category": t.category,
                        "requires_confirmation": t.requires_confirmation,
                        "enabled": t.enabled,
                    }
                    for t in tools
                ],
            }

    def import_from_zip(
        self,
        zip_data: bytes | Path,
        source_type: str = "zip",
        source_ref: str | None = None,
    ) -> str:
        """
        Import a toolset from a ZIP file.

        Args:
            zip_data: ZIP file contents as bytes or path to ZIP file
            source_type: Source type ("zip", "local", "url")
            source_ref: Original path/URL

        Returns:
            Installed toolset ID

        Raises:
            ValueError: If manifest is invalid or toolset already exists
        """
        if isinstance(zip_data, Path):
            zip_bytes = zip_data.read_bytes()
            if source_ref is None:
                source_ref = str(zip_data)
        else:
            zip_bytes = zip_data

        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            manifest_data = self._find_and_parse_manifest(zf)
            manifest = ToolsetManifest(manifest_data)

            existing = self.get_toolset(manifest.id)
            if existing:
                raise ValueError(
                    f"Toolset '{manifest.id}' already installed (version {existing['version']})"
                )

            toolset_dir = get_toolset_directory(manifest.id)
            if toolset_dir.exists():
                shutil.rmtree(toolset_dir)
            toolset_dir.mkdir(parents=True)

            file_records: list[dict[str, Any]] = []
            for zip_info in zf.infolist():
                if zip_info.is_dir():
                    continue

                rel_path = self._normalize_zip_path(zip_info.filename)
                if rel_path is None:
                    continue

                content = zf.read(zip_info.filename)
                target_path = toolset_dir / rel_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(content)

                file_records.append(
                    {
                        "path": rel_path,
                        "kind": _classify_file(rel_path),
                        "sha256": _compute_hash(content),
                        "size": len(content),
                        "stored_path": str(target_path),
                    }
                )

        self._register_toolset(
            manifest=manifest,
            file_records=file_records,
            source_type=source_type,
            source_ref=source_ref,
        )

        logger.info(f"Installed toolset '{manifest.id}' v{manifest.version}")
        return manifest.id

    def import_from_directory(self, directory: Path) -> str:
        """
        Import a toolset from a directory (for development).

        Args:
            directory: Path to toolset directory

        Returns:
            Installed toolset ID
        """
        manifest_path = directory / "toolset.yaml"
        if not manifest_path.exists():
            raise ValueError(f"No toolset.yaml found in {directory}")

        manifest_data = yaml.safe_load(manifest_path.read_text())
        manifest = ToolsetManifest(manifest_data)

        existing = self.get_toolset(manifest.id)
        if existing:
            raise ValueError(
                f"Toolset '{manifest.id}' already installed (version {existing['version']})"
            )

        toolset_dir = get_toolset_directory(manifest.id)
        if toolset_dir.exists():
            shutil.rmtree(toolset_dir)
        shutil.copytree(directory, toolset_dir)

        file_records: list[dict[str, Any]] = []
        for file_path in toolset_dir.rglob("*"):
            if file_path.is_dir():
                continue
            rel_path = str(file_path.relative_to(toolset_dir))
            content = file_path.read_bytes()
            file_records.append(
                {
                    "path": rel_path,
                    "kind": _classify_file(rel_path),
                    "sha256": _compute_hash(content),
                    "size": len(content),
                    "stored_path": str(file_path),
                }
            )

        self._register_toolset(
            manifest=manifest,
            file_records=file_records,
            source_type="local",
            source_ref=str(directory),
        )

        logger.info(
            f"Installed toolset '{manifest.id}' v{manifest.version} from directory"
        )
        return manifest.id

    def export_to_zip(self, toolset_id: str) -> bytes:
        """
        Export a toolset to a ZIP file.

        Args:
            toolset_id: Toolset ID to export

        Returns:
            ZIP file contents as bytes

        Raises:
            ValueError: If toolset not found
        """
        toolset = self.get_toolset(toolset_id)
        if toolset is None:
            raise ValueError(f"Toolset '{toolset_id}' not found")

        toolset_dir = get_toolset_directory(toolset_id)
        if not toolset_dir.exists():
            raise ValueError(f"Toolset directory not found for '{toolset_id}'")

        manifest_data = self._generate_manifest(toolset_id)

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("toolset.yaml", yaml.dump(manifest_data, sort_keys=False))

            for file_path in toolset_dir.rglob("*"):
                if file_path.is_dir():
                    continue
                rel_path = str(file_path.relative_to(toolset_dir))
                if rel_path == "toolset.yaml":
                    continue
                zf.write(file_path, rel_path)

        return zip_buffer.getvalue()

    def enable_toolset(self, toolset_id: str, enabled: bool = True) -> bool:
        """Enable or disable a toolset."""
        with db_session() as session:
            toolset = session.query(Toolset).filter(Toolset.id == toolset_id).first()
            if toolset is None:
                return False

            toolset.enabled = enabled

            session.query(Tool).filter(Tool.toolset_id == toolset_id).update(
                {"enabled": enabled}
            )

            session.query(McpServer).filter(McpServer.toolset_id == toolset_id).update(
                {"enabled": enabled}
            )

            session.commit()

        logger.info(f"{'Enabled' if enabled else 'Disabled'} toolset '{toolset_id}'")
        return True

    def uninstall(self, toolset_id: str) -> bool:
        """
        Uninstall a toolset.

        Removes all database records and files.
        """
        with db_session() as session:
            toolset = session.query(Toolset).filter(Toolset.id == toolset_id).first()
            if toolset is None:
                return False

            session.delete(toolset)

            session.query(McpServer).filter(McpServer.toolset_id == toolset_id).delete()

            session.commit()

        # Delete files
        toolset_dir = get_toolset_directory(toolset_id)
        if toolset_dir.exists():
            shutil.rmtree(toolset_dir)

        logger.info(f"Uninstalled toolset '{toolset_id}'")
        return True

    def _find_and_parse_manifest(self, zf: zipfile.ZipFile) -> dict[str, Any]:
        """Find and parse toolset.yaml in a ZIP file."""
        for name in ["toolset.yaml", "toolset.yml"]:
            if name in zf.namelist():
                content = zf.read(name).decode("utf-8")
                return yaml.safe_load(content)

        for name in zf.namelist():
            if name.endswith("/toolset.yaml") or name.endswith("/toolset.yml"):
                if name.count("/") == 1:
                    content = zf.read(name).decode("utf-8")
                    return yaml.safe_load(content)

        raise ValueError("No toolset.yaml found in ZIP file")

    def _normalize_zip_path(self, path: str) -> str | None:
        """Normalize a ZIP file path, handling nested root folders."""
        parts = path.split("/")
        if any(p.startswith(".") for p in parts if p):
            return None

        if "/" in path:
            first, rest = path.split("/", 1)
            if rest and not rest.startswith("/"):
                if first not in ("tools", "artifacts", "assets"):
                    return rest

        return path

    def _register_toolset(
        self,
        manifest: ToolsetManifest,
        file_records: list[dict[str, Any]],
        source_type: str,
        source_ref: str | None,
    ) -> None:
        """Register a toolset and its components in the database."""
        with db_session() as session:
            toolset = Toolset(
                id=manifest.id,
                name=manifest.name,
                version=manifest.version,
                description=manifest.description,
                enabled=True,
                installed_at=datetime.now().isoformat(),
                source_type=source_type,
                source_ref=source_ref,
                manifest_version=manifest.manifest_version,
            )
            session.add(toolset)

            for fr in file_records:
                tf = ToolsetFile(
                    toolset_id=manifest.id,
                    path=fr["path"],
                    kind=fr["kind"],
                    sha256=fr["sha256"],
                    size=fr["size"],
                    stored_path=fr["stored_path"],
                )
                session.add(tf)

            for tool_def in manifest.tools:
                tool_id = f"{manifest.id}:{tool_def['id']}"
                tool = Tool(
                    tool_id=tool_id,
                    toolset_id=manifest.id,
                    name=tool_def["name"],
                    description=tool_def.get("description"),
                    category=tool_def.get("category", "utility"),
                    input_schema=json.dumps(tool_def.get("input_schema"))
                    if tool_def.get("input_schema")
                    else None,
                    requires_confirmation=tool_def.get("requires_confirmation", False),
                    enabled=True,
                    entrypoint=tool_def["entrypoint"],
                )
                session.add(tool)

                renderer = tool_def.get("renderer")
                if renderer:
                    render_config = ToolRenderConfig(
                        tool_id=tool_id,
                        priority=0,
                        renderer=renderer.get("type", "code"),
                        config=json.dumps(
                            {k: v for k, v in renderer.items() if k != "type"}
                        ),
                    )
                    session.add(render_config)

            for mcp_def in manifest.mcp_servers:
                server_id = mcp_def.get("id")
                if not server_id:
                    continue

                if "command" in mcp_def:
                    server_type = "stdio"
                elif "url" in mcp_def:
                    transport = mcp_def.get("transport", "streamable-http")
                    server_type = "sse" if transport == "sse" else "streamable-http"
                else:
                    continue

                mcp_server = McpServer(
                    id=server_id,
                    server_type=server_type,
                    enabled=True,
                    command=mcp_def.get("command"),
                    args=json.dumps(mcp_def.get("args"))
                    if mcp_def.get("args")
                    else None,
                    cwd=mcp_def.get("cwd"),
                    url=mcp_def.get("url"),
                    headers=json.dumps(mcp_def.get("headers"))
                    if mcp_def.get("headers")
                    else None,
                    env=json.dumps(mcp_def.get("env")) if mcp_def.get("env") else None,
                    requires_confirmation=mcp_def.get("requires_confirmation", True),
                    created_at=datetime.now().isoformat(),
                    toolset_id=manifest.id,
                )
                session.add(mcp_server)

            session.commit()

    def _generate_manifest(self, toolset_id: str) -> dict[str, Any]:
        """Generate manifest YAML data from database state."""
        with db_session() as session:
            toolset = session.query(Toolset).filter(Toolset.id == toolset_id).first()
            if toolset is None:
                raise ValueError(f"Toolset '{toolset_id}' not found")

            tools = session.query(Tool).filter(Tool.toolset_id == toolset_id).all()
            mcp_servers = (
                session.query(McpServer)
                .filter(McpServer.toolset_id == toolset_id)
                .all()
            )

            manifest: dict[str, Any] = {
                "manifest_version": toolset.manifest_version,
                "id": toolset.id,
                "name": toolset.name,
                "version": toolset.version,
            }

            if toolset.description:
                manifest["description"] = toolset.description

            # Add tools
            if tools:
                manifest["tools"] = []
                for tool in tools:
                    # Strip toolset prefix from tool_id
                    tool_id_short = tool.tool_id
                    if tool_id_short.startswith(f"{toolset_id}:"):
                        tool_id_short = tool_id_short[len(toolset_id) + 1 :]

                    tool_data: dict[str, Any] = {
                        "id": tool_id_short,
                        "name": tool.name,
                        "entrypoint": tool.entrypoint,
                    }

                    if tool.description:
                        tool_data["description"] = tool.description
                    if tool.category != "utility":
                        tool_data["category"] = tool.category
                    if tool.input_schema:
                        tool_data["input_schema"] = json.loads(tool.input_schema)
                    if tool.requires_confirmation:
                        tool_data["requires_confirmation"] = True

                    render_configs = (
                        session.query(ToolRenderConfig)
                        .filter(ToolRenderConfig.tool_id == tool.tool_id)
                        .order_by(ToolRenderConfig.priority.desc())
                        .all()
                    )

                    if render_configs:
                        rc = render_configs[0]
                        renderer_data = {"type": rc.renderer}
                        renderer_data.update(json.loads(rc.config))
                        tool_data["renderer"] = renderer_data

                    manifest["tools"].append(tool_data)

            if mcp_servers:
                manifest["mcp_servers"] = []
                for server in mcp_servers:
                    server_data: dict[str, Any] = {"id": server.id}

                    if server.command:
                        server_data["command"] = server.command
                    if server.args:
                        server_data["args"] = json.loads(server.args)
                    if server.cwd:
                        server_data["cwd"] = server.cwd
                    if server.url:
                        server_data["url"] = server.url
                    if server.headers:
                        server_data["headers"] = json.loads(server.headers)
                    if server.env:
                        env = json.loads(server.env)
                        server_data["env"] = {k: f"${{{k}}}" for k in env.keys()}
                    if not server.requires_confirmation:
                        server_data["requires_confirmation"] = False

                    manifest["mcp_servers"].append(server_data)

            return manifest


# Singleton instance
_toolset_manager: ToolsetManager | None = None


def get_toolset_manager() -> ToolsetManager:
    """Get the global toolset manager instance."""
    global _toolset_manager
    if _toolset_manager is None:
        _toolset_manager = ToolsetManager()
    return _toolset_manager
