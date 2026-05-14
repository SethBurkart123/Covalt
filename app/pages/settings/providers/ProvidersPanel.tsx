
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, Store } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ProviderItem from './ProviderItem';

import type { ProviderConfig } from '@/lib/types/provider-catalog';
import { getProviders } from './provider-registry';
import { saveProviderSettings, uninstallProviderPlugin } from '@/python/api';
import { useOptionalChat } from '@/contexts/chat-context';
import { useProviderCatalogData } from '@/lib/hooks/providers/use-provider-catalog-data';
import { useProviderConnectionActions } from '@/lib/hooks/providers/use-provider-connection-actions';
import { useProviderFiltering } from '@/lib/hooks/providers/use-provider-filtering';
import { useProviderOauthActions } from '@/lib/hooks/providers/use-provider-oauth-actions';
import { useOauthPopup } from '@/lib/hooks/use-oauth-popup';
import type {
  ProviderConnectionUiState,
  ProviderItemRowActions,
  ProviderItemRowViewModel,
  ProviderOauthUiState,
} from './provider-item.types';
import { OpenAIIcon } from './provider-icons';

const CUSTOM_PROVIDERS_STORAGE_KEY = 'covalt:custom-providers';

interface CustomProviderEntry {
  id: string;
  baseProvider: string;
  name: string;
}

const loadCustomProviders = (): CustomProviderEntry[] => {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PROVIDERS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveCustomProviders = (entries: CustomProviderEntry[]) => {
  localStorage.setItem(CUSTOM_PROVIDERS_STORAGE_KEY, JSON.stringify(entries));
};

interface ProvidersPanelProps {
  onOpenStore?: () => void;
  scrollElement?: HTMLElement | null;
}

export default function ProvidersPanel({ onOpenStore, scrollElement }: ProvidersPanelProps) {
  const [search, setSearch] = useState('');
  const [connectionUiByProvider, setConnectionUiByProvider] = useState<Record<string, ProviderConnectionUiState>>({});
  const [oauthUiByProvider, setOauthUiByProvider] = useState<Record<string, ProviderOauthUiState>>({});
  const [customProviders, setCustomProviders] = useState<CustomProviderEntry[]>(loadCustomProviders);

  const addCustomProvider = useCallback((baseProvider: string, defaultName: string) => {
    setCustomProviders((prev) => {
      const entry: CustomProviderEntry = {
        id: `${baseProvider}:${crypto.randomUUID().slice(0, 8)}`,
        baseProvider,
        name: defaultName,
      };
      const next = [...prev, entry];
      saveCustomProviders(next);
      return next;
    });
  }, []);

  const removeCustomProvider = useCallback((id: string) => {
    setCustomProviders((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveCustomProviders(next);
      return next;
    });
  }, []);

  const renameCustomProvider = useCallback((id: string, name: string) => {
    setCustomProviders((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, name } : e));
      saveCustomProviders(next);
      return next;
    });
  }, []);

  const chatContext = useOptionalChat();
  const refreshModels = chatContext?.refreshModels;
  const customProviderIds = useMemo(
    () => customProviders.map((entry) => entry.id),
    [customProviders],
  );

  const {
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
  } = useProviderCatalogData({
    getProviders,
    extraProviderIds: customProviderIds,
  });

  const { displayProviders, isConnected } = useProviderFiltering({
    providers,
    search,
    providerConnections,
    oauthStatus,
    providerMap,
  });

  const patchConnectionUi = useCallback((providerId: string, patch: Partial<ProviderConnectionUiState>) => {
    setConnectionUiByProvider((prev) => ({
      ...prev,
      [providerId]: {
        saving: prev[providerId]?.saving ?? false,
        saved: prev[providerId]?.saved ?? false,
        status: prev[providerId]?.status ?? 'idle',
        error: prev[providerId]?.error,
        ...patch,
      },
    }));
  }, []);

  const patchOauthUi = useCallback((providerId: string, patch: Partial<ProviderOauthUiState>) => {
    setOauthUiByProvider((prev) => ({
      ...prev,
      [providerId]: {
        code: prev[providerId]?.code ?? '',
        enterpriseDomain: prev[providerId]?.enterpriseDomain ?? '',
        authenticating: prev[providerId]?.authenticating ?? false,
        revoking: prev[providerId]?.revoking ?? false,
        submitting: prev[providerId]?.submitting ?? false,
        ...patch,
      },
    }));
  }, []);

  const openOauthWindow = useOauthPopup();

  const { saveProviderConfig, testConnection } = useProviderConnectionActions({
    providerConfigs,
    providerMap,
    refreshProviderStatus,
    refreshModels,
    patchConnectionUi,
    setProviderConnections,
  });

  const { startOauth, submitOauthCode, revokeOauth } = useProviderOauthActions({
    setOauthStatus,
    patchOauthUi,
    refreshModels,
    openOauthWindow,
  });

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = useCallback(
    async (providerId: string) => {
      await saveProviderConfig(providerId);
    },
    [saveProviderConfig],
  );

  const handleTestConnection = useCallback(
    async (providerId: string) => {
      await testConnection(providerId);
    },
    [testConnection],
  );

  const handleUninstall = useCallback(
    async (providerId: string) => {
      const plugin = pluginProviders[providerId];
      if (!plugin) return;
      await uninstallProviderPlugin({ body: { id: plugin.id } });
      await loadSettings({ silent: true });
    },
    [pluginProviders, loadSettings],
  );

  const handleExtraModelsChange = useCallback(
    async (providerId: string, models: string[]) => {
      const currentExtra = (providerConfigs[providerId]?.extra ?? {}) as Record<string, unknown>;
      const nextExtra = { ...currentExtra, extraModels: models };
      setProviderConfigField(providerId, 'extra', nextExtra);
      try {
        await saveProviderSettings({ body: { provider: providerId, apiKey: undefined, baseUrl: undefined, extra: nextExtra } });
        refreshModels?.();
      } catch (error) {
        console.error('Failed to save extra models', error);
      }
    },
    [providerConfigs, setProviderConfigField, refreshModels],
  );

  const rows = useMemo(() => {
    if (isLoading) return [];
    const baseProviderDefs = new Map(providers.map((d) => [d.provider, d]));
    const customBaseProviderIds = new Set(customProviders.map((e) => e.baseProvider));
    const filteredProviders = displayProviders.filter((d) => !customBaseProviderIds.has(d.provider));

    const result: { providerId: string; def: typeof displayProviders[number]; customName?: string; onRemove?: () => void; onNameChange?: (name: string) => void }[] = [];

    const searchLower = search.trim().toLowerCase();
    for (const entry of customProviders) {
      if (searchLower && !entry.name.toLowerCase().includes(searchLower)) continue;
      const baseDef = baseProviderDefs.get(entry.baseProvider);
      if (!baseDef) continue;
      result.push({
        providerId: entry.id,
        def: baseDef,
        customName: entry.name,
        onRemove: () => removeCustomProvider(entry.id),
        onNameChange: (name) => renameCustomProvider(entry.id, name),
      });
    }

    for (const def of filteredProviders) {
      result.push({ providerId: def.provider, def });
    }

    return result;
  }, [isLoading, providers, customProviders, displayProviders, removeCustomProvider, renameCustomProvider, search]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement ?? null,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: (i) => rows[i]?.providerId ?? String(i),
  });

  const buildProviderItem = useCallback(
    (item: typeof rows[number]) => {
      const providerId = item.providerId;
      const def = item.def;

      const config =
        providerConfigs[providerId] ||
        ({
          provider: providerId,
          apiKey: '',
          baseUrl: def.defaults?.baseUrl,
        } satisfies ProviderConfig);

      const connection =
        connectionUiByProvider[providerId] ||
        ({
          saving: false,
          saved: false,
          status: 'idle',
          error: undefined,
        } satisfies ProviderConnectionUiState);

      const oauthUi =
        oauthUiByProvider[providerId] ||
        ({
          code: '',
          enterpriseDomain: '',
          authenticating: false,
          revoking: false,
          submitting: false,
        } satisfies ProviderOauthUiState);

      const displayDef = item.customName
        ? { ...def, name: item.customName, provider: providerId }
        : def;

      const row: ProviderItemRowViewModel = {
        def: displayDef,
        config,
        isConnected: isConnected(providerId),
        isPluginProvider: Boolean(pluginProviders[providerId]),
        oauthStatus: oauthStatus[providerId],
        connection,
        oauthUi,
      };

      const actions: ProviderItemRowActions = {
        onOauthCodeChange: (value) => patchOauthUi(providerId, { code: value }),
        onOauthEnterpriseDomainChange: (value) => patchOauthUi(providerId, { enterpriseDomain: value }),
        onOauthStart: () => startOauth(providerId, oauthUi.enterpriseDomain),
        onOauthSubmitCode: () => submitOauthCode(providerId, oauthUi.code || ''),
        onOauthRevoke: () => revokeOauth(providerId),
        onOauthOpenLink: openOauthWindow,
        onChange: (field, value) => setProviderConfigField(providerId, field, value),
        onSave: () => handleSave(providerId),
        onTestConnection: () => handleTestConnection(providerId),
        onExtraModelsChange: (models) => handleExtraModelsChange(providerId, models),
        ...(item.onRemove ? { onUninstall: item.onRemove } : row.isPluginProvider ? { onUninstall: () => handleUninstall(providerId) } : {}),
      };

      return (
        <ProviderItem
          row={row}
          actions={actions}
          editableName={item.onNameChange != null}
          onNameChange={item.onNameChange}
        />
      );
    },
    [
      providerConfigs, connectionUiByProvider, oauthUiByProvider,
      isConnected, pluginProviders, oauthStatus,
      patchOauthUi, startOauth, submitOauthCode, revokeOauth,
      openOauthWindow, setProviderConfigField, handleSave,
      handleTestConnection, handleExtraModelsChange, handleUninstall,
    ],
  );

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage API keys and OAuth connections for each provider.
          </p>
        </div>
      </div>

      <div className="sticky top-0 z-10 -my-2 py-2">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'color-mix(in srgb, var(--sidebar) 50%, var(--background) 50%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-full h-6 -z-10 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--sidebar) 50%, var(--background) 50%), transparent)',
          }}
        />
        <div className="flex items-center gap-2">
        <div className="relative w-full">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search providers..."
            className="pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors relative"
              aria-label="Add provider"
              title="Add provider"
            >
              <Plus size={16} />
              {hasStoreWarnings ? (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenStore}>
              <Store size={14} />
              Plugin Store
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addCustomProvider('openai_like', 'OpenAI Compatible (Custom)')}>
              <OpenAIIcon className="size-3.5" />
              Add OpenAI Compatible
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 pt-5">
          {Array.from({ length: 12 }).map((_, index) => (
            <Card key={`skeleton-${index}`} className="overflow-hidden border-border/70 py-2 gap-0">
              <div className="w-full px-4 flex items-center justify-between">
                <div className="flex items-center gap-3 text-left flex-1 min-w-0">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div
          style={{
            height: virtualizer.getTotalSize() + 20,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={rows[vi.index].providerId}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 20,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
              className="pb-3"
            >
              {buildProviderItem(rows[vi.index])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
