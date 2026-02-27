import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { saveProviderSettings, testProvider } from '@/python/api';
import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';
import type { ProviderConnectionStatus } from './types';

interface UseProviderConnectionActionsParams {
  providerConfigs: Record<string, ProviderConfig>;
  providerMap: Record<string, ProviderDefinition>;
  refreshProviderStatus: (providerIds: string[]) => Promise<void>;
  refreshModels?: () => Promise<void> | void;
  setSaving: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSaved: Dispatch<SetStateAction<Record<string, boolean>>>;
  setConnectionStatus: Dispatch<SetStateAction<Record<string, ProviderConnectionStatus>>>;
  setConnectionErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setProviderConnections: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function useProviderConnectionActions({
  providerConfigs,
  providerMap,
  refreshProviderStatus,
  refreshModels,
  setSaving,
  setSaved,
  setConnectionStatus,
  setConnectionErrors,
  setProviderConnections,
}: UseProviderConnectionActionsParams) {
  const saveProviderConfig = useCallback(
    async (providerId: string, options?: { refreshConnectionStatus?: boolean }) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') {
        return false;
      }

      setSaving((state) => ({ ...state, [providerId]: true }));
      setSaved((state) => ({ ...state, [providerId]: false }));

      try {
        const config = providerConfigs[providerId];
        if (!config) return false;

        await saveProviderSettings({
          body: {
            provider: providerId,
            apiKey: config.apiKey || undefined,
            baseUrl: config.baseUrl || undefined,
            enabled: config.enabled,
          },
        });

        setSaved((state) => ({ ...state, [providerId]: true }));
        setTimeout(() => setSaved((state) => ({ ...state, [providerId]: false })), 1500);

        refreshModels?.();
        if (options?.refreshConnectionStatus !== false) {
          setConnectionStatus((prev) => ({ ...prev, [providerId]: 'testing' }));
          refreshProviderStatus([providerId]).finally(() => {
            setConnectionStatus((prev) => ({ ...prev, [providerId]: 'idle' }));
          });
        } else {
          refreshProviderStatus([providerId]).catch((error) => {
            console.error('Failed to refresh provider status', error);
          });
        }

        return true;
      } catch (error) {
        console.error('Failed to save provider settings', providerId, error);
        return false;
      } finally {
        setSaving((state) => ({ ...state, [providerId]: false }));
      }
    },
    [
      providerConfigs,
      providerMap,
      refreshModels,
      refreshProviderStatus,
      setConnectionStatus,
      setSaved,
      setSaving,
    ],
  );

  const testConnection = useCallback(
    async (providerId: string) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') return;

      setConnectionStatus((prev) => ({ ...prev, [providerId]: 'testing' }));
      setConnectionErrors((prev) => ({ ...prev, [providerId]: '' }));

      try {
        const result = await testProvider({
          body: {
            provider: providerId,
            apiKey: providerConfigs[providerId]?.apiKey || undefined,
            baseUrl: providerConfigs[providerId]?.baseUrl || undefined,
          },
        });

        if (result.success) {
          setConnectionStatus((prev) => ({ ...prev, [providerId]: 'success' }));
          setProviderConnections((prev) => ({ ...prev, [providerId]: true }));
          void saveProviderConfig(providerId, { refreshConnectionStatus: false });
          setTimeout(() => {
            setConnectionStatus((prev) => ({ ...prev, [providerId]: 'idle' }));
          }, 3000);
          return;
        }

        setConnectionStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
        setConnectionErrors((prev) => ({
          ...prev,
          [providerId]: result.error || 'Connection failed',
        }));
      } catch (error) {
        setConnectionStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
        setConnectionErrors((prev) => ({
          ...prev,
          [providerId]: error instanceof Error ? error.message : 'Unexpected error',
        }));
      }
    },
    [
      providerConfigs,
      providerMap,
      saveProviderConfig,
      setConnectionErrors,
      setConnectionStatus,
      setProviderConnections,
    ],
  );

  return {
    saveProviderConfig,
    testConnection,
  };
}
