"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';
import { getProviders } from './provider-registry';
import { toProviderConfigMap } from '@/lib/services/provider-catalog';
import {
  getProviderOauthStatus,
  revokeProviderOauth,
  saveProviderSettings,
  startProviderOauth,
  submitProviderOauthCode,
  testProvider,
} from '@/python/api';
import { request } from '@/python/_internal';
import { useOptionalChat } from '@/contexts/chat-context';

type OAuthStatus = 'none' | 'pending' | 'authenticated' | 'error';

interface OAuthState {
  status: OAuthStatus;
  hasTokens?: boolean;
  authUrl?: string;
  instructions?: string;
  error?: string;
}

interface ProviderOAuthOverview {
  status: OAuthStatus;
  hasTokens?: boolean;
  authUrl?: string;
  instructions?: string;
  error?: string;
}

interface ProviderOverview {
  provider: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
  connected?: boolean;
  oauth?: ProviderOAuthOverview | null;
}

interface ProviderOverviewResponse {
  providers: ProviderOverview[];
}

interface ProviderPluginMeta {
  id: string;
  provider: string;
  enabled?: boolean;
  error?: string;
}

interface ProviderPluginsResponse {
  plugins: ProviderPluginMeta[];
}

const normalizeOAuthStatus = (value: unknown): OAuthStatus => {
  if (value === 'none' || value === 'pending' || value === 'authenticated' || value === 'error') {
    return value;
  }
  return 'none';
};

export default function ProvidersPanel() {
  const [search, setSearch] = useState('');
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<
    Record<string, 'idle' | 'testing' | 'success' | 'error'>
  >({});
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [providerConnections, setProviderConnections] = useState<Record<string, boolean>>({});
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthState>>({});
  const [oauthCodes, setOauthCodes] = useState<Record<string, string>>({});
  const [oauthEnterpriseDomains, setOauthEnterpriseDomains] = useState<Record<string, string>>({});
  const [oauthAuthenticating, setOauthAuthenticating] = useState<Record<string, boolean>>({});
  const [oauthRevoking, setOauthRevoking] = useState<Record<string, boolean>>({});
  const [oauthSubmitting, setOauthSubmitting] = useState<Record<string, boolean>>({});
  const [storeOpen, setStoreOpen] = useState(false);
  const [pluginProviders, setPluginProviders] = useState<Record<string, ProviderPluginMeta>>({});
  const pollIntervalRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const pollTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const chatContext = useOptionalChat();
  const refreshModels = chatContext?.refreshModels;

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.provider, provider])),
    [providers],
  );

  const fetchProviderOverview = useCallback(async (providerIds: string[]) => {
    return request<ProviderOverviewResponse>('get_provider_overview', {
      body: { providers: providerIds },
    });
  }, []);

  const stopPolling = useCallback((providerKey?: string) => {
    const stopKey = (key: string) => {
      const interval = pollIntervalRef.current[key];
      if (interval) {
        clearInterval(interval);
        delete pollIntervalRef.current[key];
      }
      const timeout = pollTimeoutRef.current[key];
      if (timeout) {
        clearTimeout(timeout);
        delete pollTimeoutRef.current[key];
      }
    };

    if (providerKey) {
      stopKey(providerKey);
      return;
    }

    Object.keys(pollIntervalRef.current).forEach(stopKey);
    Object.keys(pollTimeoutRef.current).forEach(stopKey);
  }, []);

  const openOauthWindow = useCallback((url: string) => {
    if (typeof window === 'undefined') return;
    const width = 600;
    const height = 800;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    window.open(url, 'Authenticate', `width=${width},height=${height},left=${left},top=${top}`);
  }, []);

  const pollOauthStatus = useCallback(
    async (providerId: string) => {
      try {
        const status = await getProviderOauthStatus({ body: { provider: providerId } });
        const normalized = normalizeOAuthStatus(status.status);
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: normalized,
            hasTokens: status.hasTokens,
            authUrl: status.authUrl,
            instructions: status.instructions,
            error: status.error,
          },
        }));

        if (normalized === 'authenticated') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          refreshModels?.();
        } else if (normalized === 'error') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        }
      } catch (error) {
        stopPolling(providerId);
        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to load OAuth status',
          },
        }));
      }
    },
    [refreshModels, stopPolling],
  );

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const catalog = await getProviders();
      setProviders(catalog);

      const providerIds = catalog.map((provider) => provider.provider);
      const [response, pluginResponse] = await Promise.all([
        fetchProviderOverview(providerIds),
        request<ProviderPluginsResponse>('list_provider_plugins', {}),
      ]);
      const map = toProviderConfigMap(catalog, response?.providers || []);
      const oauthMap: Record<string, OAuthState> = {};
      const connectionMap: Record<string, boolean> = {};

      (response?.providers || []).forEach((provider) => {
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
      setOauthStatus(oauthMap);
      setProviderConnections(connectionMap);
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
  }, [fetchProviderOverview]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const applyOverviewStatus = useCallback((overviewProviders: ProviderOverview[]) => {
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return providers;
    return providers.filter((provider) =>
      [provider.name, provider.description].some((value) => value.toLowerCase().includes(term)),
    );
  }, [providers, search]);

  const isConnected = useCallback(
    (providerId: string) => {
      const def = providerMap[providerId];
      if (def?.authType === 'oauth') {
        return oauthStatus[providerId]?.status === 'authenticated';
      }
      return Boolean(providerConnections[providerId]);
    },
    [oauthStatus, providerConnections, providerMap],
  );

  const displayProviders = useMemo(
    () =>
      filtered
        .slice()
        .sort((a, b) => {
          const aConnected = isConnected(a.provider) ? 0 : 1;
          const bConnected = isConnected(b.provider) ? 0 : 1;
          if (aConnected !== bConnected) return aConnected - bConnected;
          return a.name.localeCompare(b.name);
        }),
    [filtered, isConnected],
  );

  const hasStoreWarnings = useMemo(
    () => Object.values(pluginProviders).some((plugin) => Boolean(plugin.error)),
    [pluginProviders],
  );

  const updateProvider = (providerId: string, field: keyof ProviderConfig, value: string | boolean) => {
    setProviderConfigs((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], [field]: value },
    }));
  };

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
    [providerConfigs, providerMap, refreshModels, refreshProviderStatus],
  );

  const handleSave = async (providerId: string) => {
    await saveProviderConfig(providerId);
  };

  const handleTestConnection = async (providerId: string) => {
    const def = providerMap[providerId];
    if (def?.authType === 'oauth') {
      return;
    }

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
      } else {
        setConnectionStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
        setConnectionErrors((prev) => ({
          ...prev,
          [providerId]: result.error || 'Connection failed',
        }));
      }
    } catch (error) {
      setConnectionStatus((prev) => ({ ...prev, [providerId]: 'error' }));
      setProviderConnections((prev) => ({ ...prev, [providerId]: false }));
      setConnectionErrors((prev) => ({
        ...prev,
        [providerId]: error instanceof Error ? error.message : 'Unexpected error',
      }));
    }
  };

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
                  saving={!!saving[providerId]}
                  saved={!!saved[providerId]}
                  connectionStatus={connectionStatus[providerId] || 'idle'}
                  connectionError={connectionErrors[providerId]}
                  oauthStatus={oauthStatus[providerId]}
                  oauthCode={oauthCodes[providerId]}
                  oauthEnterpriseDomain={oauthEnterpriseDomains[providerId]}
                  onOauthCodeChange={(value) => setOauthCodes((prev) => ({ ...prev, [providerId]: value }))}
                  onOauthEnterpriseDomainChange={(value) =>
                    setOauthEnterpriseDomains((prev) => ({ ...prev, [providerId]: value }))
                  }
                  onOauthStart={async () => {
                    setOauthAuthenticating((prev) => ({ ...prev, [providerId]: true }));
                    stopPolling(providerId);
                    try {
                      const result = await startProviderOauth({
                        body: {
                          provider: providerId,
                          enterpriseDomain: oauthEnterpriseDomains[providerId] || undefined,
                        },
                      });

                      if (!result.success) {
                        setOauthStatus((prev) => ({
                          ...prev,
                          [providerId]: {
                            status: 'error',
                            error: result.error || 'Failed to start OAuth',
                          },
                        }));
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                        return;
                      }

                      const normalizedStatus = normalizeOAuthStatus(result.status);
                      setOauthStatus((prev) => ({
                        ...prev,
                        [providerId]: {
                          status: normalizedStatus,
                          authUrl: result.authUrl,
                          instructions: result.instructions,
                          error: result.error,
                        },
                      }));

                      if (result.authUrl) {
                        openOauthWindow(result.authUrl);
                      }

                      if (normalizedStatus === 'authenticated') {
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                        refreshModels?.();
                        return;
                      }

                      if (normalizedStatus === 'error') {
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                        return;
                      }

                      pollIntervalRef.current[providerId] = setInterval(() => {
                        void pollOauthStatus(providerId);
                      }, 2000);

                      pollTimeoutRef.current[providerId] = setTimeout(() => {
                        stopPolling(providerId);
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                      }, 5 * 60 * 1000);
                    } catch (error) {
                      setOauthStatus((prev) => ({
                        ...prev,
                        [providerId]: {
                          status: 'error',
                          error: error instanceof Error ? error.message : 'Failed to start OAuth',
                        },
                      }));
                      setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                    }
                  }}
                  onOauthSubmitCode={async () => {
                    const code = oauthCodes[providerId];
                    if (!code) return;
                    setOauthSubmitting((prev) => ({ ...prev, [providerId]: true }));
                    try {
                      const result = await submitProviderOauthCode({ body: { provider: providerId, code } });
                      if (!result.success) {
                        setOauthStatus((prev) => ({
                          ...prev,
                          [providerId]: {
                            status: 'error',
                            error: result.error || 'Failed to submit code',
                          },
                        }));
                        return;
                      }

                      const status = await getProviderOauthStatus({ body: { provider: providerId } });
                      const normalized = normalizeOAuthStatus(status.status);
                      setOauthStatus((prev) => ({
                        ...prev,
                        [providerId]: {
                          status: normalized,
                          hasTokens: status.hasTokens,
                          authUrl: status.authUrl,
                          instructions: status.instructions,
                          error: status.error,
                        },
                      }));

                      if (normalized === 'authenticated') {
                        stopPolling(providerId);
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                        refreshModels?.();
                      } else if (normalized === 'error') {
                        stopPolling(providerId);
                        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                      }
                    } catch (error) {
                      setOauthStatus((prev) => ({
                        ...prev,
                        [providerId]: {
                          status: 'error',
                          error: error instanceof Error ? error.message : 'Failed to submit code',
                        },
                      }));
                    } finally {
                      setOauthSubmitting((prev) => ({ ...prev, [providerId]: false }));
                    }
                  }}
                  onOauthRevoke={async () => {
                    stopPolling(providerId);
                    setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
                    setOauthStatus((prev) => ({
                      ...prev,
                      [providerId]: {
                        status: 'none',
                        hasTokens: false,
                        authUrl: undefined,
                        instructions: undefined,
                        error: undefined,
                      },
                    }));
                    setOauthRevoking((prev) => ({ ...prev, [providerId]: true }));
                    try {
                      await revokeProviderOauth({ body: { provider: providerId } });
                      refreshModels?.();
                    } catch (error) {
                      setOauthStatus((prev) => ({
                        ...prev,
                        [providerId]: {
                          status: 'error',
                          error: error instanceof Error ? error.message : 'Failed to revoke OAuth',
                        },
                      }));
                    } finally {
                      setOauthRevoking((prev) => ({ ...prev, [providerId]: false }));
                    }
                  }}
                  onOauthOpenLink={openOauthWindow}
                  oauthIsAuthenticating={oauthAuthenticating[providerId]}
                  oauthIsRevoking={oauthRevoking[providerId]}
                  oauthIsSubmitting={oauthSubmitting[providerId]}
                  onChange={(field, value) => updateProvider(providerId, field, value)}
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
