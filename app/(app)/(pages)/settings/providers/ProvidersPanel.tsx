"use client";

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search } from 'lucide-react';
import ProviderItem from './ProviderItem';
import ProviderStorePanel from './ProviderStorePanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProviderConfig } from '@/lib/types/provider-catalog';
import { getProviders } from './provider-registry';
import { useOptionalChat } from '@/contexts/chat-context';
import { useProviderCatalogData } from '@/lib/hooks/providers/use-provider-catalog-data';
import { useProviderConnectionActions } from '@/lib/hooks/providers/use-provider-connection-actions';
import { useProviderFiltering } from '@/lib/hooks/providers/use-provider-filtering';
import { useProviderOauthActions } from '@/lib/hooks/providers/use-provider-oauth-actions';
import type { ProviderConnectionStatus } from '@/lib/hooks/providers/types';

export default function ProvidersPanel() {
  const [search, setSearch] = useState('');
  const [storeOpen, setStoreOpen] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ProviderConnectionStatus>>({});
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [oauthCodes, setOauthCodes] = useState<Record<string, string>>({});
  const [oauthEnterpriseDomains, setOauthEnterpriseDomains] = useState<Record<string, string>>({});
  const [oauthAuthenticating, setOauthAuthenticating] = useState<Record<string, boolean>>({});
  const [oauthRevoking, setOauthRevoking] = useState<Record<string, boolean>>({});
  const [oauthSubmitting, setOauthSubmitting] = useState<Record<string, boolean>>({});

  const chatContext = useOptionalChat();
  const refreshModels = chatContext?.refreshModels;

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
  } = useProviderCatalogData({ getProviders });

  const { displayProviders, isConnected } = useProviderFiltering({
    providers,
    search,
    providerConnections,
    oauthStatus,
    providerMap,
  });

  const openOauthWindow = useCallback((url: string) => {
    if (typeof window === 'undefined') return;
    const width = 600;
    const height = 800;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    window.open(url, 'Authenticate', `width=${width},height=${height},left=${left},top=${top}`);
  }, []);

  const { saveProviderConfig, testConnection } = useProviderConnectionActions({
    providerConfigs,
    providerMap,
    refreshProviderStatus,
    refreshModels,
    setSaving,
    setSaved,
    setConnectionStatus,
    setConnectionErrors,
    setProviderConnections,
  });

  const { startOauth, submitOauthCode, revokeOauth } = useProviderOauthActions({
    setOauthStatus,
    setOauthAuthenticating,
    setOauthSubmitting,
    setOauthRevoking,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Providers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage API keys and OAuth connections for each provider.
        </p>
      </div>

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

        <button
          type="button"
          onClick={() => setStoreOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors relative"
          aria-label="Open provider store"
          title="Open provider store"
        >
          <Plus size={16} />
          {hasStoreWarnings ? (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
          ) : null}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card key={`provider-skeleton-${index}`} className="overflow-hidden border-border/70 py-2 gap-0">
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
            ))
          : displayProviders.map((def) => {
              const providerId = def.provider;
              const config =
                providerConfigs[providerId] ||
                ({
                  provider: providerId,
                  apiKey: '',
                  baseUrl: def.defaults?.baseUrl,
                  enabled: def.defaults?.enabled ?? true,
                } satisfies ProviderConfig);

              return (
                <ProviderItem
                  key={providerId}
                  def={def}
                  config={config}
                  isConnected={isConnected(providerId)}
                  isPluginProvider={Boolean(pluginProviders[providerId])}
                  saving={Boolean(saving[providerId])}
                  saved={Boolean(saved[providerId])}
                  connectionStatus={connectionStatus[providerId] || 'idle'}
                  connectionError={connectionErrors[providerId]}
                  oauthStatus={oauthStatus[providerId]}
                  oauthCode={oauthCodes[providerId]}
                  oauthEnterpriseDomain={oauthEnterpriseDomains[providerId]}
                  oauthIsAuthenticating={oauthAuthenticating[providerId]}
                  oauthIsRevoking={oauthRevoking[providerId]}
                  oauthIsSubmitting={oauthSubmitting[providerId]}
                  onOauthCodeChange={(value) =>
                    setOauthCodes((prev) => ({ ...prev, [providerId]: value }))
                  }
                  onOauthEnterpriseDomainChange={(value) =>
                    setOauthEnterpriseDomains((prev) => ({ ...prev, [providerId]: value }))
                  }
                  onOauthStart={() => startOauth(providerId, oauthEnterpriseDomains[providerId])}
                  onOauthSubmitCode={() => submitOauthCode(providerId, oauthCodes[providerId] || '')}
                  onOauthRevoke={() => revokeOauth(providerId)}
                  onOauthOpenLink={openOauthWindow}
                  onChange={(field, value) => setProviderConfigField(providerId, field, value)}
                  onSave={() => handleSave(providerId)}
                  onTestConnection={() => handleTestConnection(providerId)}
                />
              );
            })}
      </div>

      <Dialog open={storeOpen} onOpenChange={setStoreOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Provider Store</DialogTitle>
            <DialogDescription>
              Install community providers and manage uninstall from here. Enable/disable happens on provider cards.
            </DialogDescription>
          </DialogHeader>
          <ProviderStorePanel onPluginsChanged={loadSettings} compact />
        </DialogContent>
      </Dialog>
    </div>
  );
}
