from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

from ..providers import PROVIDERS
from ..providers._manifest import MANIFEST_PROVIDERS
from .provider_plugin_manager import get_provider_plugin_manager

AuthType = Literal["apiKey", "oauth"]
OAuthVariant = Literal["panel", "compact", "inline-code", "device"]


@dataclass(frozen=True)
class ProviderCatalogEntry:
    key: str
    provider: str
    name: str
    description: str
    icon: str
    auth_type: AuthType = "apiKey"
    default_base_url: Optional[str] = None
    default_enabled: bool = True
    oauth_variant: Optional[OAuthVariant] = None
    oauth_enterprise_domain: bool = False
    aliases: list[str] = field(default_factory=list)


_MANIFEST_NAME_OVERRIDES: Dict[str, str] = {
    "p302ai": "302.AI",
    "io_net": "IO.NET",
    "zai": "Z.AI",
    "zai_coding_plan": "Z.AI Coding Plan",
    "qiniu_ai": "Qiniu AI",
    "qihang_ai": "Qihang AI",
    "moonshotai": "Moonshot AI",
    "moonshotai_cn": "Moonshot AI (China)",
    "novita_ai": "Novita AI",
    "cloudflare_ai_gateway": "Cloudflare AI Gateway",
    "cloudflare_workers_ai": "Cloudflare Workers AI",
    "google_vertex": "Google Vertex",
    "google_vertex_anthropic": "Google Vertex Anthropic",
}

_MANIFEST_ICON_OVERRIDES: Dict[str, str] = {
    "p302ai": "p302ai",
    "amazon_bedrock": "amazon-bedrock",
    "azure_cognitive_services": "azure-cognitive-services",
    "cloudferro_sherlock": "cloudferro-sherlock",
    "cloudflare_ai_gateway": "cloudflare-ai-gateway",
    "cloudflare_workers_ai": "cloudflare-workers-ai",
    "fireworks_ai": "fireworks-ai",
    "github_copilot_api": "github-copilot-api",
    "github_models": "github-models",
    "io_net": "io-net",
    "kuae_cloud_coding_plan": "kuae-cloud-coding-plan",
    "nano_gpt": "nano-gpt",
    "novita_ai": "novita-ai",
    "ollama_cloud": "ollama-cloud",
    "privatemode_ai": "privatemode-ai",
    "qihang_ai": "qihang-ai",
    "qiniu_ai": "qiniu-ai",
    "sap_ai_core": "sap-ai-core",
    "siliconflow_cn": "siliconflow-cn",
    "moonshotai_cn": "moonshotai-cn",
    "zai_coding_plan": "zai-coding-plan",
    "zhipuai_coding_plan": "zhipuai-coding-plan",
}

_SPECIAL_PROVIDERS: tuple[ProviderCatalogEntry, ...] = (
    ProviderCatalogEntry(
        key="openai_like",
        provider="openai_like",
        name="OpenAI Compatible (Custom)",
        description="Any OpenAI-like API endpoint",
        icon="openai",
    ),
    ProviderCatalogEntry(
        key="ollama",
        provider="ollama",
        name="Ollama (Local)",
        description="Local models running on your machine",
        icon="ollama",
        default_base_url="http://localhost:11434",
    ),
    ProviderCatalogEntry(
        key="vllm",
        provider="vllm",
        name="vLLM (Local)",
        description="Local vLLM server (OpenAI compatible)",
        icon="vllm",
        default_base_url="http://localhost:8000/v1",
    ),
    ProviderCatalogEntry(
        key="anthropic_oauth",
        provider="anthropic_oauth",
        name="Claude OAuth",
        description="Claude Pro/Max via OAuth sign-in",
        icon="anthropic",
        auth_type="oauth",
        oauth_variant="inline-code",
    ),
    ProviderCatalogEntry(
        key="openai_codex",
        provider="openai_codex",
        name="ChatGPT OAuth",
        description="ChatGPT Plus/Pro via OAuth",
        icon="openai",
        auth_type="oauth",
        oauth_variant="compact",
    ),
    ProviderCatalogEntry(
        key="github_copilot",
        provider="github_copilot",
        name="GitHub Copilot OAuth",
        description="Copilot models via OAuth device flow",
        icon="github",
        auth_type="oauth",
        oauth_variant="device",
        oauth_enterprise_domain=True,
    ),
    ProviderCatalogEntry(
        key="google_gemini_cli",
        provider="google_gemini_cli",
        name="Gemini CLI OAuth",
        description="Cloud Code Assist Gemini models via OAuth",
        icon="google-gemini-cli",
        auth_type="oauth",
        oauth_variant="compact",
    ),
)

_CUSTOM_PROVIDER_OVERRIDES: Dict[str, ProviderCatalogEntry] = {
    "openai": ProviderCatalogEntry(
        key="openai",
        provider="openai",
        name="OpenAI",
        description="OpenAI API",
        icon="openai",
    ),
    "anthropic": ProviderCatalogEntry(
        key="anthropic",
        provider="anthropic",
        name="Anthropic",
        description="Anthropic API",
        icon="anthropic",
    ),
    "google": ProviderCatalogEntry(
        key="google",
        provider="google",
        name="Google",
        description="Google API",
        icon="google",
    ),
    "groq": ProviderCatalogEntry(
        key="groq",
        provider="groq",
        name="Groq",
        description="Groq API",
        icon="groq",
    ),
    "cohere": ProviderCatalogEntry(
        key="cohere",
        provider="cohere",
        name="Cohere",
        description="Cohere API",
        icon="cohere",
    ),
    "openrouter": ProviderCatalogEntry(
        key="openrouter",
        provider="openrouter",
        name="OpenRouter",
        description="OpenRouter API",
        icon="openrouter",
    ),
    "lmstudio": ProviderCatalogEntry(
        key="lmstudio",
        provider="lmstudio",
        name="LM Studio",
        description="LM Studio API",
        icon="lmstudio",
        default_base_url="http://localhost:1234/v1",
    ),
    "minimax": ProviderCatalogEntry(
        key="minimax",
        provider="minimax",
        name="MiniMax",
        description="MiniMax API",
        icon="minimax",
        default_base_url="https://api.minimax.io/v1",
    ),
    "minimax_cn": ProviderCatalogEntry(
        key="minimax_cn",
        provider="minimax_cn",
        name="MiniMax (China)",
        description="MiniMax (China) API",
        icon="minimax",
        default_base_url="https://api.minimaxi.chat/v1",
    ),
    "minimax_coding_plan": ProviderCatalogEntry(
        key="minimax_coding_plan",
        provider="minimax_coding_plan",
        name="MiniMax Coding Plan",
        description="MiniMax Coding Plan API",
        icon="minimax",
        default_base_url="https://api.minimax.io/v1",
    ),
    "minimax_cn_coding_plan": ProviderCatalogEntry(
        key="minimax_cn_coding_plan",
        provider="minimax_cn_coding_plan",
        name="MiniMax (China) Coding Plan",
        description="MiniMax (China) Coding Plan API",
        icon="minimax",
        default_base_url="https://api.minimaxi.chat/v1",
    ),
    "kimi_for_coding": ProviderCatalogEntry(
        key="kimi_for_coding",
        provider="kimi_for_coding",
        name="Kimi for Coding",
        description="Kimi for Coding API",
        icon="kimi",
        default_base_url="https://api.moonshot.cn/v1",
    ),
    "google_vertex": ProviderCatalogEntry(
        key="google_vertex",
        provider="google_vertex",
        name="Google Vertex",
        description="Google Vertex API",
        icon="vertex-ai",
    ),
    "google_vertex_anthropic": ProviderCatalogEntry(
        key="google_vertex_anthropic",
        provider="google_vertex_anthropic",
        name="Google Vertex Anthropic",
        description="Google Vertex Anthropic API",
        icon="vertex-ai",
    ),
    "zenmux": ProviderCatalogEntry(
        key="zenmux",
        provider="zenmux",
        name="ZenMux",
        description="ZenMux API",
        icon="openai",
        default_base_url="https://zenmux.ai/api/anthropic/v1",
    ),
}

_EXCLUDED_PROVIDERS = {"e2e", "google_code_assist"}


def _to_title(provider_id: str) -> str:
    normalized = provider_id.replace("_", " ").strip()
    words = normalized.split()
    if not words:
        return provider_id
    return " ".join(
        word.upper() if word.lower() in {"ai", "cn", "io"} else word.capitalize()
        for word in words
    )


def _to_description(name: str) -> str:
    return f"{name} API"


def _build_manifest_entries() -> list[ProviderCatalogEntry]:
    entries: list[ProviderCatalogEntry] = []
    for raw in MANIFEST_PROVIDERS:
        data: Dict[str, Any] = dict(raw)
        provider_id = str(data.get("id") or "").strip()
        if not provider_id or provider_id not in PROVIDERS:
            continue

        aliases = data.get("aliases") or []
        if not isinstance(aliases, list):
            aliases = []

        base_url = data.get("base_url")
        name = _MANIFEST_NAME_OVERRIDES.get(provider_id, _to_title(provider_id))
        icon = _MANIFEST_ICON_OVERRIDES.get(provider_id, provider_id.replace("_", "-"))
        entries.append(
            ProviderCatalogEntry(
                key=provider_id,
                provider=provider_id,
                name=name,
                description=_to_description(name),
                icon=icon,
                default_base_url=str(base_url) if isinstance(base_url, str) else None,
                aliases=[str(alias) for alias in aliases if isinstance(alias, str)],
            )
        )
    return entries


def _build_plugin_entries() -> list[ProviderCatalogEntry]:
    entries: list[ProviderCatalogEntry] = []
    manager = get_provider_plugin_manager()
    for plugin in manager.list_plugins():
        if plugin.error:
            continue
        if plugin.provider not in PROVIDERS:
            continue
        entries.append(
            ProviderCatalogEntry(
                key=plugin.id,
                provider=plugin.provider,
                name=plugin.name,
                description=plugin.description,
                icon=plugin.icon,
                auth_type=plugin.auth_type,
                default_base_url=plugin.default_base_url,
                default_enabled=plugin.enabled,
                oauth_variant=plugin.oauth_variant,
                oauth_enterprise_domain=plugin.oauth_enterprise_domain,
                aliases=list(plugin.aliases),
            )
        )
    return entries


def _build_fallback_entry(provider_id: str) -> ProviderCatalogEntry:
    if provider_id in _CUSTOM_PROVIDER_OVERRIDES:
        return _CUSTOM_PROVIDER_OVERRIDES[provider_id]

    name = _to_title(provider_id)
    return ProviderCatalogEntry(
        key=provider_id,
        provider=provider_id,
        name=name,
        description=_to_description(name),
        icon=provider_id.replace("_", "-"),
    )


def list_provider_catalog() -> list[ProviderCatalogEntry]:
    by_provider: dict[str, ProviderCatalogEntry] = {}

    for entry in _build_manifest_entries():
        by_provider[entry.provider] = entry

    for entry in _build_plugin_entries():
        by_provider[entry.provider] = entry

    for entry in _SPECIAL_PROVIDERS:
        if entry.provider in PROVIDERS:
            by_provider[entry.provider] = entry

    for provider_id in PROVIDERS.keys():
        if provider_id in _EXCLUDED_PROVIDERS or provider_id in by_provider:
            continue
        by_provider[provider_id] = _build_fallback_entry(provider_id)

    return sorted(by_provider.values(), key=lambda entry: entry.name.lower())
