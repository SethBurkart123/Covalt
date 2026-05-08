"""Renderer registry: descriptors for built-in and plugin-supplied renderers."""

from .registry import (
    RendererRegistry,
    all_renderers,
    clear_registry,
    get_renderer,
    is_renderer_registered,
    list_renderer_keys,
    register_builtin_renderers,
    register_renderer,
    register_renderers,
    renderer_config_schema,
    resolve_renderer_alias,
)

__all__ = [
    "RendererRegistry",
    "all_renderers",
    "clear_registry",
    "get_renderer",
    "is_renderer_registered",
    "list_renderer_keys",
    "register_builtin_renderers",
    "register_renderer",
    "register_renderers",
    "renderer_config_schema",
    "resolve_renderer_alias",
]
