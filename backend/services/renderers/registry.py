from __future__ import annotations

from collections.abc import Iterable
from threading import RLock

from nodes._types import RendererDescriptor


class RendererRegistry:
    def __init__(self) -> None:
        self._by_key: dict[str, RendererDescriptor] = {}
        self._alias_to_key: dict[str, str] = {}
        self._lock = RLock()

    def register(self, descriptor: RendererDescriptor) -> None:
        with self._lock:
            key = descriptor.key
            if not isinstance(key, str) or not key.strip():
                raise ValueError("renderer descriptor.key must be a non-empty string")

            existing = self._by_key.get(key)
            if existing is not None:
                if existing == descriptor:
                    return
                raise ValueError(
                    f"renderer '{key}' already registered with a different descriptor"
                )

            for alias in descriptor.aliases:
                mapped = self._alias_to_key.get(alias)
                if mapped is not None and mapped != key:
                    raise ValueError(
                        f"renderer alias '{alias}' already maps to '{mapped}'"
                    )
                if alias in self._by_key and alias != key:
                    raise ValueError(
                        f"renderer alias '{alias}' collides with canonical key"
                    )

            self._by_key[key] = descriptor
            for alias in descriptor.aliases:
                self._alias_to_key[alias] = key

    def register_many(self, descriptors: Iterable[RendererDescriptor]) -> None:
        for descriptor in descriptors:
            self.register(descriptor)

    def unregister(self, key: str) -> None:
        with self._lock:
            descriptor = self._by_key.pop(key, None)
            if descriptor is None:
                return
            for alias in descriptor.aliases:
                if self._alias_to_key.get(alias) == key:
                    self._alias_to_key.pop(alias, None)

    def clear(self) -> None:
        with self._lock:
            self._by_key.clear()
            self._alias_to_key.clear()

    def get(self, key: str) -> RendererDescriptor | None:
        with self._lock:
            canonical = self._alias_to_key.get(key, key)
            return self._by_key.get(canonical)

    def resolve_alias(self, key: str) -> str:
        with self._lock:
            if key in self._by_key:
                return key
            return self._alias_to_key.get(key, key)

    def has(self, key: str) -> bool:
        with self._lock:
            canonical = self._alias_to_key.get(key, key)
            return canonical in self._by_key

    def list_keys(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._by_key.keys())

    def all(self) -> tuple[RendererDescriptor, ...]:
        with self._lock:
            return tuple(self._by_key.values())

    def config_schema(self, key: str) -> dict[str, str] | None:
        descriptor = self.get(key)
        if descriptor is None:
            return None
        return descriptor.config_schema


_registry = RendererRegistry()


def register_renderer(descriptor: RendererDescriptor) -> None:
    _registry.register(descriptor)


def register_renderers(descriptors: Iterable[RendererDescriptor]) -> None:
    _registry.register_many(descriptors)


def get_renderer(key: str) -> RendererDescriptor | None:
    return _registry.get(key)


def resolve_renderer_alias(key: str) -> str:
    return _registry.resolve_alias(key)


def is_renderer_registered(key: str) -> bool:
    return _registry.has(key)


def list_renderer_keys() -> tuple[str, ...]:
    return _registry.list_keys()


def all_renderers() -> tuple[RendererDescriptor, ...]:
    return _registry.all()


def renderer_config_schema(key: str) -> dict[str, str] | None:
    return _registry.config_schema(key)


def clear_registry() -> None:
    _registry.clear()


def register_builtin_renderers() -> None:
    # Historical 6 built-ins plus the `markdown -> document` alias retained from RENDERER_ALIAS_MAP.
    descriptors: tuple[RendererDescriptor, ...] = (
        RendererDescriptor(key="default", config_schema={}),
        RendererDescriptor(
            key="code",
            config_schema={
                "file": "string",
                "content": "string",
                "language": "string",
                "editable": "bool",
            },
        ),
        RendererDescriptor(
            key="document",
            aliases=("markdown",),
            config_schema={
                "file": "string",
                "content": "string",
                "editable": "bool",
            },
        ),
        RendererDescriptor(
            key="html",
            config_schema={
                "content": "string",
                "artifact": "string",
                "data": "any",
            },
        ),
        RendererDescriptor(
            key="frame",
            config_schema={
                "url": "string",
                "port": "port",
            },
        ),
        RendererDescriptor(
            key="editor",
            config_schema={
                "path": "string",
                "editable": "bool",
            },
        ),
    )
    _registry.register_many(descriptors)
