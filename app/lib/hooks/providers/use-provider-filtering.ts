import { useMemo } from 'react';
import type { ProviderDefinition } from '@/lib/types/provider-catalog';
import type { OAuthState } from './types';

interface UseProviderFilteringParams {
  providers: ProviderDefinition[];
  search: string;
  providerConnections: Record<string, boolean>;
  oauthStatus: Record<string, OAuthState>;
  providerMap: Record<string, ProviderDefinition>;
}

export function useProviderFiltering({
  providers,
  search,
  providerConnections,
  oauthStatus,
  providerMap,
}: UseProviderFilteringParams) {
  const filteredProviders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return providers;
    return providers.filter((provider) =>
      [provider.name, provider.description].some((value) => value.toLowerCase().includes(term)),
    );
  }, [providers, search]);

  const isConnected = useMemo(() => {
    return (providerId: string) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') {
        return oauthStatus[providerId]?.status === 'authenticated';
      }
      return Boolean(providerConnections[providerId]);
    };
  }, [oauthStatus, providerConnections, providerMap]);

  const displayProviders = useMemo(
    () =>
      filteredProviders
        .slice()
        .sort((a, b) => {
          const aConnected = isConnected(a.provider) ? 0 : 1;
          const bConnected = isConnected(b.provider) ? 0 : 1;
          if (aConnected !== bConnected) return aConnected - bConnected;
          return a.name.localeCompare(b.name);
        }),
    [filteredProviders, isConnected],
  );

  return {
    filteredProviders,
    displayProviders,
    isConnected,
  };
}
