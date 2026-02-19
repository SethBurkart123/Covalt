"use client";

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import ProviderItem from './ProviderItem';
import { PROVIDERS, ProviderConfig } from './ProviderRegistry';
import {
  getProviderOauthStatus,
  getProviderSettings,
  revokeProviderOauth,
  saveProviderSettings,
  startProviderOauth,
  submitProviderOauthCode,
  testProvider,
} from '@/python/api';
import { useModels } from '@/lib/hooks/useModels';

type OAuthStatus = 'none' | 'pending' | 'authenticated' | 'error';

interface OAuthState {
  status: OAuthStatus;
  hasTokens?: boolean;
  authUrl?: string;
  instructions?: string;
  error?: string;
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
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthState>>({});
  const [oauthCodes, setOauthCodes] = useState<Record<string, string>>({});
  const [oauthEnterpriseDomains, setOauthEnterpriseDomains] = useState<Record<string, string>>({});
  const { connectedProviders, refreshModels } = useModels();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await getProviderSettings();
      const map: Record<string, ProviderConfig> = {};

      (response?.providers || []).forEach((p) => {
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
      }

      setProviderConfigs(map);
      await loadOauthStatuses();
    } catch {
      const fallback: Record<string, ProviderConfig> = {};
      for (const def of PROVIDERS) {
        fallback[def.key] = {
          provider: def.key,
          apiKey: '',
          baseUrl: def.defaults?.baseUrl,
          enabled: def.defaults?.enabled ?? true,
        };
      }
      setProviderConfigs(fallback);
      await loadOauthStatuses();
    } finally {
      setIsLoading(false);
    }
  };

  const loadOauthStatuses = async () => {
    const entries = PROVIDERS.filter((p) => p.authType === 'oauth');
    if (entries.length === 0) return;
    const results = await Promise.all(entries.map(async (def) => {
      try {
        const status = await getProviderOauthStatus({ body: { provider: def.key } });
        return [def.key, {
          status: normalizeOAuthStatus(status.status),
          hasTokens: status.hasTokens,
          authUrl: status.authUrl,
          instructions: status.instructions,
          error: status.error,
        }] as const;
      } catch {
        return [def.key, { status: 'error', error: 'Failed to load OAuth status' }] as const;
      }
    }));
    setOauthStatus((prev) => {
      const next = { ...prev };
      results.forEach(([key, status]) => {
        next[key] = status;
      });
      return next;
    });
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return PROVIDERS;
    return PROVIDERS.filter((p) =>
      [p.name, p.description].some((t) => t.toLowerCase().includes(s))
    );
  }, [search]);

  const isConnected = (key: string) => connectedProviders.includes(key);

  const displayProviders = useMemo(() => 
    filtered
      .slice()
      .sort((a, b) => {
        const aConnected = connectedProviders.includes(a.key) ? 0 : 1;
        const bConnected = connectedProviders.includes(b.key) ? 0 : 1;
        if (aConnected !== bConnected) return aConnected - bConnected;
        return a.name.localeCompare(b.name);
      }),
  [filtered, connectedProviders]);

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
      refreshModels().finally(() => {
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
        setTimeout(() => {
          setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'idle' }));
        }, 3000);
      } else {
        setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'error' }));
        setConnectionErrors((prev) => ({ 
          ...prev, 
          [providerKey]: result.error || 'Connection failed' 
        }));
      }
    } catch (error) {
      setConnectionStatus((prev) => ({ ...prev, [providerKey]: 'error' }));
      setConnectionErrors((prev) => ({ 
        ...prev, 
        [providerKey]: error instanceof Error ? error.message : 'Unexpected error' 
      }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
        {displayProviders.map((def) => (
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
              const result = await startProviderOauth({
                body: {
                  provider: def.key,
                  enterpriseDomain: oauthEnterpriseDomains[def.key] || undefined,
                },
              });
              setOauthStatus((prev) => ({
                ...prev,
                [def.key]: {
                  status: normalizeOAuthStatus(result.status),
                  authUrl: result.authUrl,
                  instructions: result.instructions,
                  error: result.error,
                },
              }));
            }}
            onOauthSubmitCode={async () => {
              const code = oauthCodes[def.key];
              if (!code) return;
              await submitProviderOauthCode({ body: { provider: def.key, code } });
              setOauthCodes((prev) => ({ ...prev, [def.key]: '' }));
              const status = await getProviderOauthStatus({ body: { provider: def.key } });
              setOauthStatus((prev) => ({
                ...prev,
                [def.key]: {
                  status: normalizeOAuthStatus(status.status),
                  hasTokens: status.hasTokens,
                  authUrl: status.authUrl,
                  instructions: status.instructions,
                  error: status.error,
                },
              }));
              if (normalizeOAuthStatus(status.status) === 'authenticated') {
                refreshModels();
              }
            }}
            onOauthRevoke={async () => {
              await revokeProviderOauth({ body: { provider: def.key } });
              const status = await getProviderOauthStatus({ body: { provider: def.key } });
              setOauthStatus((prev) => ({
                ...prev,
                [def.key]: {
                  status: normalizeOAuthStatus(status.status),
                  hasTokens: status.hasTokens,
                  authUrl: status.authUrl,
                  instructions: status.instructions,
                  error: status.error,
                },
              }));
              refreshModels();
            }}
            onChange={(field, value) => updateProvider(def.key, field, value)}
            onSave={() => handleSave(def.key)}
            onTestConnection={() => handleTestConnection(def.key)}
          />
        ))}
      </div>
    </div>
  );
}
