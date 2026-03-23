import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { saveProviderSettings, testProvider } from '@/python/api';
import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';
import type { ProviderConnectionStatus } from './types';

interface ConnectionUiPatch {
  saving?: boolean;
  saved?: boolean;
  status?: ProviderConnectionStatus;
  error?: string;
}

interface UseProviderConnectionActionsParams {
  providerConfigs: Record<string, ProviderConfig>;
  providerMap: Record<string, ProviderDefinition>;
  refreshProviderStatus: (providerIds: string[]) => Promise<void>;
  refreshModels?: () => Promise<void> | void;
  patchConnectionUi: (providerId: string, patch: ConnectionUiPatch) => void;
  setProviderConnections: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function useProviderConnectionActions({
  providerConfigs,
  providerMap,
  refreshProviderStatus,
  refreshModels,
  patchConnectionUi,
  setProviderConnections,
}: UseProviderConnectionActionsParams) {
  const saveProviderConfig = useCallback(
    async (providerId: string, options?: { refreshConnectionStatus?: boolean }) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') {
        return false;
      }

      patchConnectionUi(providerId, { saving: true, saved: false });

      try {
        const config = providerConfigs[providerId];
        if (!config) return false;

        await saveProviderSettings({
          body: {
            provider: providerId,
            apiKey: config.apiKey || undefined,
            baseUrl: config.baseUrl || undefined,
          },
        });

        patchConnectionUi(providerId, { saved: true });
        setTimeout(() => patchConnectionUi(providerId, { saved: false }), 1500);

        refreshModels?.();
        if (options?.refreshConnectionStatus !== false) {
          patchConnectionUi(providerId, { status: 'testing' });
          refreshProviderStatus([providerId]).finally(() => {
            patchConnectionUi(providerId, { status: 'idle' });
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
        patchConnectionUi(providerId, { saving: false });
      }
    },
    [patchConnectionUi, providerConfigs, providerMap, refreshModels, refreshProviderStatus],
  );

  const testConnection = useCallback(
    async (providerId: string) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') return;

      patchConnectionUi(providerId, { status: 'testing', error: '' });

      try {
        const result = await testProvider({
          body: {
            provider: providerId,
            apiKey: providerConfigs[providerId]?.apiKey || undefined,
            baseUrl: providerConfigs[providerId]?.baseUrl || undefined,
          },
        });

        if (result.success) {
          patchConnectionUi(providerId, { status: 'success', error: '' });
          setProviderConnections((prev) => ({ ...prev, [providerId]: true }));
          void saveProviderConfig(providerId, { refreshConnectionStatus: false });
          setTimeout(() => {
            patchConnectionUi(providerId, { status: 'idle' });
          }, 3000);
          return;
        }

        patchConnectionUi(providerId, {
          status: 'error',
          error: result.error || 'Connection failed',
        });
        setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
      } catch (error) {
        patchConnectionUi(providerId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unexpected error',
        });
        setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [patchConnectionUi, providerConfigs, providerMap, saveProviderConfig, setProviderConnections],
  );

  return {
    saveProviderConfig,
    testConnection,
  };
}
