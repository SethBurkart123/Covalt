import { fetchProviderCatalog, createProviderMap } from '@/lib/services/provider-catalog';
import type { ProviderDefinition } from '@/lib/types/provider-catalog';

let providersCache: ProviderDefinition[] | null = null;
let providersPromise: Promise<ProviderDefinition[]> | null = null;

export const getProviders = async (options?: { force?: boolean }): Promise<ProviderDefinition[]> => {
  if (options?.force) {
    providersCache = null;
    providersPromise = null;
  }

  if (providersCache) {
    return providersCache;
  }

  if (!providersPromise) {
    providersPromise = fetchProviderCatalog(options)
      .then((providers) => {
        providersCache = providers;
        return providers;
      })
      .catch((error) => {
        providersPromise = null;
        throw error;
      });
  }

  return providersPromise;
};

export const getProviderMap = async (options?: { force?: boolean }): Promise<Record<string, ProviderDefinition>> => {
  const providers = await getProviders(options);
  return createProviderMap(providers);
};

export type { ProviderDefinition };
