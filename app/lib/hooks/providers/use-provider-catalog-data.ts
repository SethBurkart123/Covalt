import { useCallback, useMemo, useState } from 'react';
import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';
import { toProviderConfigMap } from '@/lib/services/provider-catalog';
import { request } from '@/python/_internal';
import type {
  OAuthState,
  ProviderOverviewResponse,
  ProviderPluginMeta,
  ProviderPluginsResponse,
} from './types';
import { normalizeOAuthStatus } from './types';

interface UseProviderCatalogDataParams {
  getProviders: (options?: { force?: boolean }) => Promise<ProviderDefinition[]>;
}

export function useProviderCatalogData({ getProviders }: UseProviderCatalogDataParams) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [providerConnections, setProviderConnections] = useState<Record<string, boolean>>({});
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthState>>({});
  const [pluginProviders, setPluginProviders] = useState<Record<string, ProviderPluginMeta>>({});
  const [isLoading, setIsLoading] = useState(true);

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.provider, provider])),
    [providers],
  );

  const fetchProviderOverview = useCallback(async (providerIds: string[]) => {
    return request<ProviderOverviewResponse>('get_provider_overview', {
      body: { providers: providerIds },
    });
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const catalog = await getProviders({ force: true });
      setProviders(catalog);

      const providerIds = catalog.map((provider) => provider.provider);
      const [overviewResponse, pluginResponse] = await Promise.all([
        fetchProviderOverview(providerIds),
        request<ProviderPluginsResponse>('list_provider_plugins', {}),
      ]);

      const map = toProviderConfigMap(catalog, overviewResponse?.providers || []);
      const oauthMap: Record<string, OAuthState> = {};
      const connectionMap: Record<string, boolean> = {};

      (overviewResponse?.providers || []).forEach((provider) => {
        connectionMap[provider.provider] = Boolean(provider.connected);

        if (provider.oauth) {
          oauthMap[provider.provider] = {
            status: normalizeOAuthStatus(provider.oauth.status),
            hasTokens: provider.oauth.hasTokens,
            authUrl: provider.oauth.authUrl,
            instructions: provider.oauth.instructions,
            error: provider.oauth.error,
          };
        }
      });

      for (const def of catalog) {
        if (connectionMap[def.provider] === undefined) {
          connectionMap[def.provider] = false;
        }
        if (def.authType === 'oauth' && !oauthMap[def.provider]) {
          oauthMap[def.provider] = { status: 'none' };
        }
      }

      const pluginsByProvider: Record<string, ProviderPluginMeta> = {};
      for (const plugin of pluginResponse.plugins || []) {
        if (!plugin.provider) continue;
        pluginsByProvider[plugin.provider] = plugin;
      }

      setProviderConfigs(map);
      setProviderConnections(connectionMap);
      setOauthStatus(oauthMap);
      setPluginProviders(pluginsByProvider);
    } catch {
      const catalog = await getProviders().catch(() => []);
      setProviders(catalog);
      const fallback = toProviderConfigMap(catalog);
      const fallbackOauth: Record<string, OAuthState> = {};
      const fallbackConnections: Record<string, boolean> = {};

      for (const def of catalog) {
        fallbackConnections[def.provider] = false;
        if (def.authType === 'oauth') {
          fallbackOauth[def.provider] = { status: 'none' };
        }
      }

      setProviderConfigs(fallback);
      setOauthStatus(fallbackOauth);
      setProviderConnections(fallbackConnections);
      setPluginProviders({});
    } finally {
      setIsLoading(false);
    }
  }, [fetchProviderOverview, getProviders]);

  const applyOverviewStatus = useCallback((overviewProviders: ProviderOverviewResponse['providers']) => {
    setProviderConnections((prev) => {
      const next = { ...prev };
      overviewProviders.forEach((provider) => {
        if (provider.connected !== undefined) {
          next[provider.provider] = Boolean(provider.connected);
        }
      });
      return next;
    });

    setOauthStatus((prev) => {
      const next = { ...prev };
      overviewProviders.forEach((provider) => {
        if (provider.oauth) {
          next[provider.provider] = {
            status: normalizeOAuthStatus(provider.oauth.status),
            hasTokens: provider.oauth.hasTokens,
            authUrl: provider.oauth.authUrl,
            instructions: provider.oauth.instructions,
            error: provider.oauth.error,
          };
        }
      });
      return next;
    });
  }, []);

  const refreshProviderStatus = useCallback(
    async (providerIds: string[]) => {
      try {
        const response = await fetchProviderOverview(providerIds);
        applyOverviewStatus(response.providers || []);
      } catch (error) {
        console.error('Failed to refresh provider status', error);
      }
    },
    [applyOverviewStatus, fetchProviderOverview],
  );

  const setProviderConfigField = useCallback(
    (providerId: string, field: keyof ProviderConfig, value: string | boolean) => {
      setProviderConfigs((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], [field]: value },
      }));
    },
    [],
  );

  const hasStoreWarnings = useMemo(
    () => Object.values(pluginProviders).some((plugin) => Boolean(plugin.error)),
    [pluginProviders],
  );

  return {
    providers,
    providerMap,
    providerConfigs,
    providerConnections,
    oauthStatus,
    pluginProviders,
    hasStoreWarnings,
    isLoading,
    loadSettings,
    refreshProviderStatus,
    setProviderConfigField,
    setOauthStatus,
    setProviderConnections,
    fetchProviderOverview,
  };
}
