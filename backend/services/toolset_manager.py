from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from ..config import get_db_directory
from ..db import db_session
from sqlalchemy import func
from ..db.models import (
    Agent,
    Chat,
    OAuthToken,
    Tool,
    ToolCall,
    ToolOverride,
    Toolset,
    ToolsetFile,
    ToolsetMcpServer,
    UserSettings,
)

logger = logging.getLogger(__name__)

SUPPORTED_MANIFEST_VERSIONS = ["1"]
SERVER_KEY_DELIMITER = "~"
_TOOLSET_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify_toolset_id(name: str) -> str:
    slug = _TOOLSET_SLUG_RE.sub("-", name.strip().lower())
    slug = slug.strip("-")
    return slug or "mcp-server"


def get_toolsets_directory() -> Path:
    toolsets_dir = get_db_directory() / "toolsets"
    toolsets_dir.mkdir(parents=True, exist_ok=True)
    return toolsets_dir


def get_toolset_directory(toolset_id: str) -> Path:
    return get_toolsets_directory() / toolset_id


def _compute_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _classify_file(path: str) -> str:
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
    def __init__(self, data: dict[str, Any]):
        self.raw = data
        self._validate()

    def _validate(self) -> None:
        if "id" not in self.raw:
            raise ValueError("Manifest missing required field: id")
        if "name" not in self.raw:
            raise ValueError("Manifest missing required field: name")
        if "version" not in self.raw:
            raise ValueError("Manifest missing required field: version")
        if SERVER_KEY_DELIMITER in str(self.raw.get("id", "")):
            raise ValueError(f"Toolset id cannot contain '{SERVER_KEY_DELIMITER}'")

        manifest_version = self.raw.get("manifest_version", "1")
        if manifest_version not in SUPPORTED_MANIFEST_VERSIONS:
            raise ValueError(f"Unsupported manifest version: {manifest_version}")

        for i, tool in enumerate(self.raw.get("tools", [])):
            if "id" not in tool:
                raise ValueError(f"Tool at index {i} missing required field: id")
            if "entrypoint" not in tool:
                raise ValueError(
                    f"Tool at index {i} missing required field: entrypoint"
                )

        for i, override in enumerate(self.raw.get("tool_overrides", [])):
            if "tool_id" not in override:
                raise ValueError(
                    f"Tool override at index {i} missing required field: tool_id"
                )

        for i, mcp_server in enumerate(self.raw.get("mcp_servers", [])):
            server_id = mcp_server.get("id")
            if server_id and SERVER_KEY_DELIMITER in str(server_id):
                raise ValueError(
                    f"MCP server id cannot contain '{SERVER_KEY_DELIMITER}' (index {i})"
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

    @property
    def tool_overrides(self) -> list[dict[str, Any]]:
        return self.raw.get("tool_overrides", [])


class ToolsetManager:
    def __init__(self) -> None:
        self.toolsets_dir = get_toolsets_directory()

    def _ensure_unique_toolset_id(
        self, base_id: str, *, exclude_toolset_id: str | None = None
    ) -> str:
        candidate = base_id
        suffix = 1
        with db_session() as sess:
            while True:
                if exclude_toolset_id and candidate == exclude_toolset_id:
                    return candidate
                exists = (
                    sess.query(Toolset)
                    .filter(Toolset.id == candidate)
                    .first()
                )
                if not exists:
                    return candidate
                candidate = f"{base_id}-{suffix}"
                suffix += 1

    def _derive_user_mcp_id(
        self, name: str, *, exclude_toolset_id: str | None = None
    ) -> str:
        base_id = _slugify_toolset_id(name)
        return self._ensure_unique_toolset_id(
            base_id, exclude_toolset_id=exclude_toolset_id
        )

    def _normalize_override_tool_id(self, raw_id: str, toolset_id: str) -> str:
        tool_id = raw_id.strip()
        if tool_id.startswith("mcp:"):
            tool_id = tool_id[4:]
        if ":" not in tool_id:
            return f"{toolset_id}:{tool_id}"
        return tool_id

    def list_toolsets(self, user_mcp: bool | None = None) -> list[dict[str, Any]]:
        with db_session() as sess:
            query = sess.query(Toolset)
            if user_mcp is not None:
                query = query.filter(Toolset.user_mcp == user_mcp)
            toolsets = query.all()
            tool_counts = dict(
                sess.query(Tool.toolset_id, func.count(Tool.tool_id))
                .group_by(Tool.toolset_id)
                .all()
            )
            return [
                {
                    "id": t.id,
                    "name": t.name,
                    "version": t.version,
                    "description": t.description,
                    "enabled": t.enabled,
                    "user_mcp": t.user_mcp,
                    "installed_at": t.installed_at,
                    "source_type": t.source_type,
                    "tool_count": tool_counts.get(t.id, 0),
                }
                for t in toolsets
            ]

    def get_toolset(self, toolset_id: str) -> dict[str, Any] | None:
        with db_session() as session:
            toolset = session.query(Toolset).filter(Toolset.id == toolset_id).first()
            if not toolset:
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
        toolset = self.get_toolset(toolset_id)
        if not toolset:
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
        with db_session() as sess:
            toolset = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            if not toolset:
                return False

            toolset.enabled = enabled
            sess.query(Tool).filter(Tool.toolset_id == toolset_id).update(
                {"enabled": enabled}
            )
            sess.query(ToolsetMcpServer).filter(
                ToolsetMcpServer.toolset_id == toolset_id
            ).update({"enabled": enabled})
            sess.commit()

        logger.info(f"{'Enabled' if enabled else 'Disabled'} toolset '{toolset_id}'")
        return True

    def uninstall(self, toolset_id: str) -> bool:
        with db_session() as sess:
            toolset = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            if not toolset:
                return False

            sess.delete(toolset)
            sess.commit()

        toolset_dir = get_toolset_directory(toolset_id)
        if toolset_dir.exists():
            shutil.rmtree(toolset_dir)

        logger.info(f"Uninstalled toolset '{toolset_id}'")
        return True

    def _find_and_parse_manifest(self, zf: zipfile.ZipFile) -> dict[str, Any]:
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
        parts = path.split("/")
        if any(p.startswith(".") for p in parts if p):
            return None

        if "/" in path:
            first, rest = path.split("/", 1)
            if (
                rest
                and not rest.startswith("/")
                and first not in ("tools", "artifacts", "assets")
            ):
                return rest

        return path

    def _register_toolset(
        self,
        manifest: ToolsetManifest,
        file_records: list[dict[str, Any]],
        source_type: str,
        source_ref: str | None,
        user_mcp: bool = False,
    ) -> None:
        with db_session() as sess:
            toolset = Toolset(
                id=manifest.id,
                name=manifest.name,
                version=manifest.version,
                description=manifest.description,
                enabled=True,
                user_mcp=user_mcp,
                installed_at=datetime.now().isoformat(),
                source_type=source_type,
                source_ref=source_ref,
                manifest_version=manifest.manifest_version,
            )
            sess.add(toolset)

            for fr in file_records:
                tf = ToolsetFile(
                    toolset_id=manifest.id,
                    path=fr["path"],
                    kind=fr["kind"],
                    sha256=fr["sha256"],
                    size=fr["size"],
                    stored_path=fr["stored_path"],
                )
                sess.add(tf)

            override_entries: dict[str, dict[str, Any]] = {}

            for tool_def in manifest.tools:
                tool_id = f"{manifest.id}:{tool_def['id']}"
                tool = Tool(
                    tool_id=tool_id,
                    toolset_id=manifest.id,
                    name=tool_def.get("name", tool_def["id"]),
                    description=tool_def.get("description"),
                    input_schema=None,
                    requires_confirmation=tool_def.get("requires_confirmation", False),
                    enabled=True,
                    entrypoint=tool_def["entrypoint"],
                )
                sess.add(tool)

                renderer = tool_def.get("renderer")
                if renderer:
                    override_entries[tool_id] = {
                        "renderer": renderer.get("type", "code"),
                        "renderer_config": {
                            k: v for k, v in renderer.items() if k != "type"
                        },
                    }

            for override_def in manifest.tool_overrides:
                raw_tool_id = override_def.get("tool_id")
                if not raw_tool_id:
                    continue

                tool_id = self._normalize_override_tool_id(raw_tool_id, manifest.id)
                entry = override_entries.get(tool_id, {})

                if "renderer" in override_def:
                    entry["renderer"] = override_def.get("renderer")
                if "renderer_config" in override_def or "rendererConfig" in override_def:
                    entry["renderer_config"] = override_def.get("renderer_config") or override_def.get(
                        "rendererConfig"
                    )
                if "name_override" in override_def or "nameOverride" in override_def:
                    entry["name_override"] = override_def.get("name_override") or override_def.get(
                        "nameOverride"
                    )
                if (
                    "description_override" in override_def
                    or "descriptionOverride" in override_def
                ):
                    entry["description_override"] = override_def.get(
                        "description_override"
                    ) or override_def.get("descriptionOverride")
                if (
                    "requires_confirmation" in override_def
                    or "requiresConfirmation" in override_def
                ):
                    entry["requires_confirmation"] = override_def.get(
                        "requires_confirmation"
                    )
                    if entry.get("requires_confirmation") is None:
                        entry["requires_confirmation"] = override_def.get(
                            "requiresConfirmation"
                        )
                if "enabled" in override_def:
                    entry["enabled"] = override_def.get("enabled")

                if entry:
                    override_entries[tool_id] = entry

            for tool_id, override in override_entries.items():
                has_any = any(
                    key in override
                    for key in (
                        "renderer",
                        "renderer_config",
                        "name_override",
                        "description_override",
                        "requires_confirmation",
                        "enabled",
                    )
                )
                if not has_any:
                    continue

                sess.add(
                    ToolOverride(
                        id=str(uuid.uuid4()),
                        toolset_id=manifest.id,
                        tool_id=tool_id,
                        renderer=override.get("renderer"),
                        renderer_config=json.dumps(override.get("renderer_config"))
                        if override.get("renderer_config") is not None
                        else None,
                        name_override=override.get("name_override"),
                        description_override=override.get("description_override"),
                        requires_confirmation=override.get("requires_confirmation"),
                        enabled=override.get("enabled")
                        if override.get("enabled") is not None
                        else True,
                    )
                )

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

                mcp_server = ToolsetMcpServer(
                    id=server_id,
                    toolset_id=manifest.id,
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
                )
                sess.add(mcp_server)

            sess.commit()

    def _generate_manifest(self, toolset_id: str) -> dict[str, Any]:
        with db_session() as sess:
            toolset = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            if not toolset:
                raise ValueError(f"Toolset '{toolset_id}' not found")

            tools = sess.query(Tool).filter(Tool.toolset_id == toolset_id).all()
            mcp_servers = (
                sess.query(ToolsetMcpServer)
                .filter(ToolsetMcpServer.toolset_id == toolset_id)
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

            if tools:
                manifest["tools"] = []
                for tool in tools:
                    tool_id_short = tool.tool_id
                    if tool_id_short.startswith(f"{toolset_id}:"):
                        tool_id_short = tool_id_short[len(toolset_id) + 1 :]

                    tool_data: dict[str, Any] = {
                        "id": tool_id_short,
                        "entrypoint": tool.entrypoint,
                    }

                    if tool.name and tool.name != tool_id_short:
                        tool_data["name"] = tool.name
                    if tool.description:
                        tool_data["description"] = tool.description
                    if tool.requires_confirmation:
                        tool_data["requires_confirmation"] = True

                    override = (
                        sess.query(ToolOverride)
                        .filter(
                            ToolOverride.toolset_id == toolset_id,
                            ToolOverride.tool_id == tool.tool_id,
                        )
                        .first()
                    )

                    if override and override.renderer:
                        renderer_data: dict[str, Any] = {"type": override.renderer}
                        if override.renderer_config:
                            renderer_data.update(json.loads(override.renderer_config))
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
                    if server.server_type in ("sse", "streamable-http"):
                        server_data["transport"] = (
                            "sse" if server.server_type == "sse" else "streamable-http"
                        )
                    if server.env:
                        env = json.loads(server.env)
                        server_data["env"] = {k: f"${{{k}}}" for k in env.keys()}
                    if not server.requires_confirmation:
                        server_data["requires_confirmation"] = False

                    manifest["mcp_servers"].append(server_data)

            overrides = (
                sess.query(ToolOverride)
                .filter(ToolOverride.toolset_id == toolset_id)
                .all()
            )

            tool_overrides: list[dict[str, Any]] = []
            for override in overrides:
                is_toolset_tool = override.tool_id.startswith(f"{toolset_id}:")
                has_extra = bool(
                    override.name_override
                    or override.description_override
                    or override.requires_confirmation is not None
                    or override.enabled is False
                )
                if is_toolset_tool and not has_extra:
                    continue

                tool_id_short = override.tool_id
                if is_toolset_tool:
                    tool_id_short = tool_id_short[len(toolset_id) + 1 :]

                entry: dict[str, Any] = {"tool_id": tool_id_short}

                if override.renderer:
                    entry["renderer"] = override.renderer
                if override.renderer_config:
                    entry["renderer_config"] = json.loads(override.renderer_config)
                if override.name_override:
                    entry["name_override"] = override.name_override
                if override.description_override:
                    entry["description_override"] = override.description_override
                if override.requires_confirmation is not None:
                    entry["requires_confirmation"] = override.requires_confirmation
                if override.enabled is False:
                    entry["enabled"] = False

                tool_overrides.append(entry)

            if tool_overrides:
                manifest["tool_overrides"] = tool_overrides

            return manifest

    def create_user_mcp_toolset(self, name: str) -> str:
        clean_name = name.strip() or "MCP Server"
        toolset_id = self._derive_user_mcp_id(clean_name)
        if SERVER_KEY_DELIMITER in toolset_id:
            raise ValueError(f"Toolset id cannot contain '{SERVER_KEY_DELIMITER}'")
        with db_session() as sess:
            existing = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            if existing:
                raise ValueError(f"Toolset '{toolset_id}' already exists")

            toolset = Toolset(
                id=toolset_id,
                name=clean_name,
                version="1.0.0",
                enabled=True,
                user_mcp=True,
                installed_at=datetime.now().isoformat(),
                manifest_version="1",
            )
            sess.add(toolset)
            sess.commit()

        logger.info(f"Created user_mcp toolset '{toolset_id}'")
        return toolset_id

    def rename_user_mcp_toolset(
        self, toolset_id: str, name: str
    ) -> tuple[str, str, str, str]:
        with db_session() as sess:
            toolset = sess.query(Toolset).filter(Toolset.id == toolset_id).first()
            if not toolset:
                raise ValueError(f"Toolset '{toolset_id}' not found")
            if not toolset.user_mcp:
                raise ValueError("Only user MCP toolsets can be renamed")

            clean_name = name.strip() or toolset.name
            new_toolset_id = self._derive_user_mcp_id(
                clean_name, exclude_toolset_id=toolset_id
            )
            if new_toolset_id == toolset_id:
                toolset.name = clean_name
                sess.commit()
                return toolset_id, toolset_id, toolset_id, clean_name

            servers = (
                sess.query(ToolsetMcpServer)
                .filter(ToolsetMcpServer.toolset_id == toolset_id)
                .all()
            )
            if not servers:
                raise ValueError(f"No MCP server found for toolset '{toolset_id}'")
            if len(servers) > 1:
                raise ValueError(
                    f"Toolset '{toolset_id}' has multiple MCP servers; rename is unsupported"
                )
            server = servers[0]

            old_server_id = server.id
            new_server_id = new_toolset_id

            new_toolset = Toolset(
                id=new_toolset_id,
                name=clean_name,
                version=toolset.version,
                description=toolset.description,
                enabled=toolset.enabled,
                user_mcp=toolset.user_mcp,
                installed_at=toolset.installed_at,
                source_type=toolset.source_type,
                source_ref=toolset.source_ref,
                manifest_version=toolset.manifest_version,
            )
            sess.add(new_toolset)
            sess.flush()

            sess.query(ToolsetMcpServer).filter(
                ToolsetMcpServer.toolset_id == toolset_id,
                ToolsetMcpServer.id == old_server_id,
            ).update(
                {
                    ToolsetMcpServer.toolset_id: new_toolset_id,
                    ToolsetMcpServer.id: new_server_id,
                }
            )

            sess.query(ToolsetFile).filter(
                ToolsetFile.toolset_id == toolset_id
            ).update({ToolsetFile.toolset_id: new_toolset_id})

            sess.query(Tool).filter(Tool.toolset_id == toolset_id).update(
                {Tool.toolset_id: new_toolset_id}
            )

            overrides = (
                sess.query(ToolOverride)
                .filter(ToolOverride.toolset_id == toolset_id)
                .all()
            )
            for override in overrides:
                override.toolset_id = new_toolset_id
                if override.tool_id.startswith(f"{old_server_id}:"):
                    override.tool_id = (
                        f"{new_server_id}:{override.tool_id[len(old_server_id) + 1 :]}"
                    )

            sess.query(OAuthToken).filter(
                OAuthToken.toolset_id == toolset_id
            ).update(
                {
                    OAuthToken.toolset_id: new_toolset_id,
                    OAuthToken.server_id: new_server_id,
                }
            )

            sess.query(Toolset).filter(Toolset.id == toolset_id).delete()
            sess.commit()

        old_server_key = f"{toolset_id}{SERVER_KEY_DELIMITER}{old_server_id}"
        new_server_key = f"{new_toolset_id}{SERVER_KEY_DELIMITER}{new_server_id}"

        with db_session() as sess:
            sess.query(ToolCall).filter(
                ToolCall.tool_id.like(f"mcp:{old_server_key}:%")
            ).update(
                {
                    ToolCall.tool_id: func.replace(
                        ToolCall.tool_id,
                        f"mcp:{old_server_key}:",
                        f"mcp:{new_server_key}:",
                    )
                },
                synchronize_session=False,
            )

            default_tools = (
                sess.query(UserSettings)
                .filter(UserSettings.key == "default_tool_ids")
                .first()
            )
            if default_tools and default_tools.value:
                try:
                    tool_ids = json.loads(default_tools.value)
                    if isinstance(tool_ids, list):
                        updated = [
                            tid.replace(
                                f"mcp:{old_server_key}:", f"mcp:{new_server_key}:"
                            )
                            if isinstance(tid, str)
                            and tid.startswith(f"mcp:{old_server_key}:")
                            else tid
                            for tid in tool_ids
                        ]
                        if updated != tool_ids:
                            default_tools.value = json.dumps(updated)
                except Exception:
                    logger.warning("Failed to update default tool ids for MCP rename")

            chats = sess.query(Chat).filter(Chat.agent_config.isnot(None)).all()
            for chat in chats:
                try:
                    config = json.loads(chat.agent_config)
                except Exception:
                    continue
                tool_ids = config.get("tool_ids")
                if not isinstance(tool_ids, list):
                    continue
                updated = [
                    tid.replace(
                        f"mcp:{old_server_key}:", f"mcp:{new_server_key}:"
                    )
                    if isinstance(tid, str)
                    and tid.startswith(f"mcp:{old_server_key}:")
                    else tid
                    for tid in tool_ids
                ]
                if updated != tool_ids:
                    config["tool_ids"] = updated
                    chat.agent_config = json.dumps(config)

            agents = sess.query(Agent).all()
            for agent in agents:
                if not agent.graph_data:
                    continue
                if f"mcp:{old_server_key}:" not in agent.graph_data:
                    continue
                agent.graph_data = agent.graph_data.replace(
                    f"mcp:{old_server_key}:", f"mcp:{new_server_key}:"
                )

            sess.commit()

        old_dir = get_toolset_directory(toolset_id)
        new_dir = get_toolset_directory(new_toolset_id)
        if old_dir.exists() and not new_dir.exists():
            try:
                old_dir.rename(new_dir)
            except Exception as exc:
                logger.warning(
                    f"Failed to rename toolset directory {old_dir} -> {new_dir}: {exc}"
                )
        if new_dir.exists():
            with db_session() as sess:
                files = (
                    sess.query(ToolsetFile)
                    .filter(ToolsetFile.toolset_id == new_toolset_id)
                    .all()
                )
                old_prefix = str(old_dir)
                new_prefix = str(new_dir)
                updated = False
                for file in files:
                    if file.stored_path.startswith(old_prefix):
                        file.stored_path = file.stored_path.replace(
                            old_prefix, new_prefix, 1
                        )
                        updated = True
                if updated:
                    sess.commit()

        return toolset_id, new_toolset_id, new_server_id, clean_name


_toolset_manager: ToolsetManager | None = None


def get_toolset_manager() -> ToolsetManager:
    global _toolset_manager
    if _toolset_manager is None:
        _toolset_manager = ToolsetManager()
    return _toolset_manager
