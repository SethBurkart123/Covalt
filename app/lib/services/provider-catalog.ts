import { request } from '@/python/_internal';
import type {
  ProviderCatalogItem,
  ProviderCatalogResponse,
  ProviderConfig,
  ProviderDefinition,
  ProviderFieldDef,
} from '@/lib/types/provider-catalog';
import { getProviderIcon } from '@/(app)/(pages)/settings/providers/provider-icons';

const toProviderId = (value: string): string => value.toLowerCase().trim().replace(/-/g, '_');

const FIELD_DEFINITIONS: Record<
  'standard_api_key' | 'openai_compatible' | 'local_ollama' | 'local_vllm',
  ProviderFieldDef[]
> = {
  standard_api_key: [
    { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'API_KEY' },
    {
      id: 'baseUrl',
      label: 'Base URL (optional)',
      type: 'text',
      placeholder: 'https://api.example.com/v1',
      required: false,
    },
  ],
  openai_compatible: [
    { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'API_KEY' },
    { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.example.com/v1' },
  ],
  local_ollama: [{ id: 'baseUrl', label: 'Host URL', type: 'text', placeholder: 'http://localhost:11434' }],
  local_vllm: [{ id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:8000/v1' }],
};

const getFields = (provider: ProviderCatalogItem): ProviderFieldDef[] => {
  if (provider.authType === 'oauth') return [];

  const mode =
    provider.fieldMode === 'openai_compatible' ||
    provider.fieldMode === 'local_ollama' ||
    provider.fieldMode === 'local_vllm' ||
    provider.fieldMode === 'standard_api_key'
      ? provider.fieldMode
      : 'standard_api_key';

  return FIELD_DEFINITIONS[mode];
};

const toProviderDefinition = (provider: ProviderCatalogItem): ProviderDefinition => {
  const providerId = toProviderId(provider.provider);
  return {
    key: provider.key,
    provider: providerId,
    aliases: (provider.aliases || []).map(toProviderId),
    name: provider.name,
    description: provider.description,
    icon: getProviderIcon(provider.icon),
    fields: getFields(provider),
    defaults: {
      enabled: provider.defaultEnabled,
      baseUrl: provider.defaultBaseUrl || undefined,
    },
    authType: provider.authType,
    oauth:
      provider.authType === 'oauth'
        ? {
            enterpriseDomain: provider.oauthEnterpriseDomain,
            variant: provider.oauthVariant || 'panel',
          }
        : undefined,
  };
};

let providerCatalogPromise: Promise<ProviderDefinition[]> | null = null;
let providerCatalogCache: ProviderDefinition[] | null = null;

export const fetchProviderCatalog = async (options?: { force?: boolean }): Promise<ProviderDefinition[]> => {
  const forceRefresh = Boolean(options?.force);

  if (forceRefresh) {
    providerCatalogPromise = null;
  }

  if (providerCatalogCache && !forceRefresh) {
    return providerCatalogCache;
  }

  if (!providerCatalogPromise) {
    providerCatalogPromise = request<ProviderCatalogResponse>('get_provider_catalog', {})
      .then((response) => {
        const providers = (response.providers || []).map(toProviderDefinition);
        providerCatalogCache = providers;
        return providers;
      })
      .catch((error) => {
        providerCatalogPromise = null;
        if (providerCatalogCache) {
          return providerCatalogCache;
        }
        throw error;
      });
  }

  return providerCatalogPromise;
};

export const toProviderConfigMap = (
  providers: ProviderDefinition[],
  source: Array<{ provider: string; apiKey?: string | null; baseUrl?: string | null; enabled?: boolean }> = []
): Record<string, ProviderConfig> => {
  const byAlias = new Map<string, string>();
  for (const provider of providers) {
    const providerId = toProviderId(provider.provider);
    byAlias.set(providerId, providerId);
    byAlias.set(toProviderId(provider.key), providerId);
    for (const alias of provider.aliases || []) {
      byAlias.set(toProviderId(alias), providerId);
    }
  }

  const configMap: Record<string, ProviderConfig> = {};
  for (const provider of providers) {
    const providerId = toProviderId(provider.provider);
    configMap[providerId] = {
      provider: providerId,
      apiKey: '',
      baseUrl: provider.defaults?.baseUrl,
      enabled: provider.defaults?.enabled ?? true,
    };
  }

  for (const row of source) {
    const sourceKey = toProviderId(row.provider || '');
    const providerId = byAlias.get(sourceKey) || sourceKey;
    if (!configMap[providerId]) {
      configMap[providerId] = { provider: providerId, enabled: true };
    }
    configMap[providerId] = {
      ...configMap[providerId],
      provider: providerId,
      apiKey: row.apiKey ?? configMap[providerId].apiKey ?? '',
      baseUrl: row.baseUrl ?? configMap[providerId].baseUrl,
      enabled: row.enabled ?? configMap[providerId].enabled,
    };
  }

  return configMap;
};

export const createProviderMap = (providers: ProviderDefinition[]): Record<string, ProviderDefinition> => {
  const map: Record<string, ProviderDefinition> = {};
  for (const provider of providers) {
    const providerId = toProviderId(provider.provider);
    map[providerId] = provider;
    map[toProviderId(provider.key)] = provider;
    for (const alias of provider.aliases || []) {
      map[toProviderId(alias)] = provider;
    }
  }
  return map;
};
