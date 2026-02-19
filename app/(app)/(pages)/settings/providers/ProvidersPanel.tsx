"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import ProviderItem from './ProviderItem';
import { PROVIDERS, ProviderConfig } from './ProviderRegistry';
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
  extra?: unknown;
  enabled?: boolean;
  connected?: boolean;
  oauth?: ProviderOAuthOverview | null;
}

interface ProviderOverviewResponse {
  providers: ProviderOverview[];
}

const normalizeOAuthStatus = (value: unknown): OAuthStatus => {
  if (value === 'none' || value === 'pending' || value === 'authenticated' || value === 'error') {
    return value;
  }
  return 'none';
};

export default function ProvidersPanel() {
  const [search, setSearch] = useState('');
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
  const pollIntervalRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const pollTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const chatContext = useOptionalChat();
  const refreshModels = chatContext?.refreshModels;

  const fetchProviderOverview = useCallback(async (providers: string[]) => {
    return request<ProviderOverviewResponse>("get_provider_overview", {
      body: { providers },
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
    window.open(
      url,
      'Authenticate',
      `width=${width},height=${height},left=${left},top=${top}`
    );
  }, []);

  const pollOauthStatus = useCallback(async (providerKey: string) => {
    try {
      const status = await getProviderOauthStatus({ body: { provider: providerKey } });
      const normalized = normalizeOAuthStatus(status.status);
      setOauthStatus((prev) => ({
        ...prev,
        [providerKey]: {
          status: normalized,
          hasTokens: status.hasTokens,
          authUrl: status.authUrl,
          instructions: status.instructions,
          error: status.error,
        },
      }));

      if (normalized === 'authenticated') {
        stopPolling(providerKey);
        setOauthAuthenticating((prev) => ({ ...prev, [providerKey]: false }));
        refreshModels?.();
      } else if (normalized === 'error') {
        stopPolling(providerKey);
        setOauthAuthenticating((prev) => ({ ...prev, [providerKey]: false }));
      }
    } catch (error) {
      stopPolling(providerKey);
      setOauthAuthenticating((prev) => ({ ...prev, [providerKey]: false }));
      setOauthStatus((prev) => ({
        ...prev,
        [providerKey]: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to load OAuth status',
        },
      }));
    }
  }, [refreshModels, stopPolling]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetchProviderOverview(PROVIDERS.map((p) => p.key));
      const map: Record<string, ProviderConfig> = {};
      const oauthMap: Record<string, OAuthState> = {};
      const connectionMap: Record<string, boolean> = {};

      (response?.providers || []).forEach((p: ProviderOverview) => {
        const extra = typeof p.extra === 'string'
          ? p.extra
          : p.extra && typeof p.extra === 'object'
          ? JSON.stringify(p.extra, null, 2)
          : '';

        map[p.provider] = {
          provider: p.provider,
          apiKey: p.apiKey ?? '',
          baseUrl: p.baseUrl ?? '',
          extra,
          enabled: Boolean(p.enabled ?? true),
        };

        connectionMap[p.provider] = Boolean(p.connected);

        if (p.oauth) {
          oauthMap[p.provider] = {
            status: normalizeOAuthStatus(p.oauth.status),
            hasTokens: p.oauth.hasTokens,
            authUrl: p.oauth.authUrl,
            instructions: p.oauth.instructions,
            error: p.oauth.error,
          };
        }
      });

      for (const def of PROVIDERS) {
        if (!map[def.key]) {
          map[def.key] = {
            provider: def.key,
            apiKey: '',
            baseUrl: def.defaults?.baseUrl,
            extra: '',
            enabled: def.defaults?.enabled ?? true,
          };
        }
        if (connectionMap[def.key] === undefined) {
          connectionMap[def.key] = false;
        }
        if (def.authType === 'oauth' && !oauthMap[def.key]) {
          oauthMap[def.key] = { status: 'none' };
        }
      }

      setProviderConfigs(map);
      setOauthStatus(oauthMap);
      setProviderConnections(connectionMap);
    } catch {
      const fallback: Record<string, ProviderConfig> = {};
      const fallbackOauth: Record<string, OAuthState> = {};
      const fallbackConnections: Record<string, boolean> = {};
      for (const def of PROVIDERS) {
        fallback[def.key] = {
          provider: def.key,
          apiKey: '',
          baseUrl: def.defaults?.baseUrl,
          enabled: def.defaults?.enabled ?? true,
        };
        fallbackConnections[def.key] = false;
        if (def.authType === 'oauth') {
          fallbackOauth[def.key] = { status: 'none' };
        }
      }
      setProviderConfigs(fallback);
      setOauthStatus(fallbackOauth);
      setProviderConnections(fallbackConnections);
    } finally {
      setIsLoading(false);
    }
  };

  const applyOverviewStatus = useCallback((providers: ProviderOverview[]) => {
    setProviderConnections((prev) => {
      const next = { ...prev };
      providers.forEach((p) => {
        if (p.connected !== undefined) {
          next[p.provider] = Boolean(p.connected);
        }
      });
      return next;
    });

    setOauthStatus((prev) => {
      const next = { ...prev };
      providers.forEach((p) => {
        if (p.oauth) {
          next[p.provider] = {
            status: normalizeOAuthStatus(p.oauth.status),
            hasTokens: p.oauth.hasTokens,
            authUrl: p.oauth.authUrl,
            instructions: p.oauth.instructions,
            error: p.oauth.error,
          };
        }
      });
      return next;
    });
  }, []);

  const refreshProviderStatus = useCallback(async (providers: string[]) => {
    try {
      const response = await fetchProviderOverview(providers);
      applyOverviewStatus(response.providers || []);
    } catch (error) {
      console.error('Failed to refresh provider status', error);
    }
  }, [applyOverviewStatus, fetchProviderOverview]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return PROVIDERS;
    return PROVIDERS.filter((p) =>
      [p.name, p.description].some((t) => t.toLowerCase().includes(s))
    );
  }, [search]);

  const isConnected = (key: string) => {
    const def = PROVIDERS.find((p) => p.key === key);
    if (def?.authType === 'oauth') {
      return oauthStatus[key]?.status === 'authenticated';
    }
    return Boolean(providerConnections[key]);
  };

  const displayProviders = useMemo(() => 
    filtered
      .slice()
      .sort((a, b) => {
        const aConnected = isConnected(a.key) ? 0 : 1;
        const bConnected = isConnected(b.key) ? 0 : 1;
        if (aConnected !== bConnected) return aConnected - bConnected;
        return a.name.localeCompare(b.name);
      }),
  [filtered, oauthStatus, providerConnections]);

  const updateProvider = (key: string, field: keyof ProviderConfig, value: string | boolean) => {
    setProviderConfigs((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleSave = async (key: string) => {
    const def = PROVIDERS.find((p) => p.key === key);
    if (def?.authType === 'oauth') {
      return;
    }
    setSaving((s) => ({ ...s, [key]: true }));
    setSaved((s) => ({ ...s, [key]: false }));
    try {
      const cfg = providerConfigs[key];
      let extra = undefined;
      if (typeof cfg.extra === 'string' && cfg.extra.trim().length > 0) {
        try {
          extra = JSON.parse(cfg.extra);
        } catch {
          extra = cfg.extra;
        }
      }

      await saveProviderSettings({
        body: {
          provider: key,
          apiKey: cfg.apiKey || undefined,
          baseUrl: cfg.baseUrl || undefined,
          extra,
          enabled: cfg.enabled,
        },
      });
      setSaving((s) => ({ ...s, [key]: false }));
      setSaved((s) => ({ ...s, [key]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 1500);
      
      setConnectionStatus((prev) => ({ ...prev, [key]: 'testing' }));
      refreshModels?.();
      refreshProviderStatus([key]).finally(() => {
        setConnectionStatus((prev) => ({ ...prev, [key]: 'idle' }));
      });
    } catch (e) {
      console.error('Failed to save provider settings', key, e);
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const handleTestConnection = async (providerKey: string) => {
    const def = PROVIDERS.find((p) => p.key === providerKey);
    if (def?.authType === 'oauth') {
      return;
    }
    setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'testing' }));
    setConnectionErrors((prev) => ({ ...prev, [providerKey]: '' }));

    try {
      const result = await testProvider({ 
        body: { 
          provider: providerKey,
          apiKey: providerConfigs[providerKey]?.apiKey || undefined,
          baseUrl: providerConfigs[providerKey]?.baseUrl || undefined,
        } 
      });

      if (result.success) {
        setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'success' }));
        setProviderConnections((prev) => ({ ...prev, [providerKey]: true }));
        setTimeout(() => {
          setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'idle' }));
        }, 3000);
      } else {
        setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'error' }));
        setProviderConnections((prev) => ({ ...prev, [providerKey]: false }));
        setConnectionErrors((prev) => ({ 
          ...prev, 
          [providerKey]: result.error || 'Connection failed' 
        }));
      }
    } catch (error) {
      setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'error' }));
      setProviderConnections((prev) => ({ ...prev, [providerKey]: false }));
      setConnectionErrors((prev) => ({ 
        ...prev, 
        [providerKey]: error instanceof Error ? error.message : 'Unexpected error' 
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers..."
            className="pl-8"
          />
        </div>
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
          : displayProviders.map((def) => (
              <ProviderItem
                key={def.key}
                def={def}
                config={providerConfigs[def.key]}
                isConnected={isConnected(def.key)}
                saving={!!saving[def.key]}
                saved={!!saved[def.key]}
                connectionStatus={connectionStatus[def.key] || 'idle'}
                connectionError={connectionErrors[def.key]}
                oauthStatus={oauthStatus[def.key]}
                oauthCode={oauthCodes[def.key]}
                oauthEnterpriseDomain={oauthEnterpriseDomains[def.key]}
                onOauthCodeChange={(value) => setOauthCodes((prev) => ({ ...prev, [def.key]: value }))}
                onOauthEnterpriseDomainChange={(value) => setOauthEnterpriseDomains((prev) => ({ ...prev, [def.key]: value }))}
                onOauthStart={async () => {
                  setOauthAuthenticating((prev) => ({ ...prev, [def.key]: true }));
                  stopPolling(def.key);
                  try {
                    const result = await startProviderOauth({
                      body: {
                        provider: def.key,
                        enterpriseDomain: oauthEnterpriseDomains[def.key] || undefined,
                      },
                    });

                    if (!result.success) {
                      setOauthStatus((prev) => ({
                        ...prev,
                        [def.key]: {
                          status: 'error',
                          error: result.error || 'Failed to start OAuth',
                        },
                      }));
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                      return;
                    }

                    const normalizedStatus = normalizeOAuthStatus(result.status);
                    setOauthStatus((prev) => ({
                      ...prev,
                      [def.key]: {
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
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                      refreshModels?.();
                      return;
                    }

                    if (normalizedStatus === 'error') {
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                      return;
                    }

                    pollIntervalRef.current[def.key] = setInterval(() => {
                      void pollOauthStatus(def.key);
                    }, 2000);

                    pollTimeoutRef.current[def.key] = setTimeout(() => {
                      stopPolling(def.key);
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                    }, 5 * 60 * 1000);
                  } catch (error) {
                    setOauthStatus((prev) => ({
                      ...prev,
                      [def.key]: {
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Failed to start OAuth',
                      },
                    }));
                    setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                  }
                }}
                onOauthSubmitCode={async () => {
                  const code = oauthCodes[def.key];
                  if (!code) return;
                  setOauthSubmitting((prev) => ({ ...prev, [def.key]: true }));
                  try {
                    const result = await submitProviderOauthCode({ body: { provider: def.key, code } });
                    if (!result.success) {
                      setOauthStatus((prev) => ({
                        ...prev,
                        [def.key]: {
                          status: 'error',
                          error: result.error || 'Failed to submit code',
                        },
                      }));
                      return;
                    }

                    const status = await getProviderOauthStatus({ body: { provider: def.key } });
                    const normalized = normalizeOAuthStatus(status.status);
                    setOauthStatus((prev) => ({
                      ...prev,
                      [def.key]: {
                        status: normalized,
                        hasTokens: status.hasTokens,
                        authUrl: status.authUrl,
                        instructions: status.instructions,
                        error: status.error,
                      },
                    }));
                    if (normalized === 'authenticated') {
                      stopPolling(def.key);
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                      refreshModels?.();
                    } else if (normalized === 'error') {
                      stopPolling(def.key);
                      setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                    }
                  } catch (error) {
                    setOauthStatus((prev) => ({
                      ...prev,
                      [def.key]: {
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Failed to submit code',
                      },
                    }));
                  } finally {
                    setOauthSubmitting((prev) => ({ ...prev, [def.key]: false }));
                  }
                }}
                onOauthRevoke={async () => {
                  stopPolling(def.key);
                  setOauthAuthenticating((prev) => ({ ...prev, [def.key]: false }));
                  setOauthStatus((prev) => ({
                    ...prev,
                    [def.key]: {
                      status: 'none',
                      hasTokens: false,
                      authUrl: undefined,
                      instructions: undefined,
                      error: undefined,
                    },
                  }));
                  setOauthRevoking((prev) => ({ ...prev, [def.key]: true }));
                  try {
                    await revokeProviderOauth({ body: { provider: def.key } });
                    refreshModels?.();
                  } catch (error) {
                    setOauthStatus((prev) => ({
                      ...prev,
                      [def.key]: {
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Failed to revoke OAuth',
                      },
                    }));
                  } finally {
                    setOauthRevoking((prev) => ({ ...prev, [def.key]: false }));
                  }
                }}
                onOauthOpenLink={openOauthWindow}
                oauthIsAuthenticating={oauthAuthenticating[def.key]}
                oauthIsRevoking={oauthRevoking[def.key]}
                oauthIsSubmitting={oauthSubmitting[def.key]}
                onChange={(field, value) => updateProvider(def.key, field, value)}
                onSave={() => handleSave(def.key)}
                onTestConnection={() => handleTestConnection(def.key)}
              />
            ))}
      </div>
    </div>
  );
}
