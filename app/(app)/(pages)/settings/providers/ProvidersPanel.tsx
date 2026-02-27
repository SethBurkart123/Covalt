"use client";

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Search, Shield, RefreshCw, Loader2, Upload, Plug, Settings } from 'lucide-react';
import ProviderItem from './ProviderItem';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { ProviderConfig } from '@/lib/types/provider-catalog';
import type {
  ProviderPluginIndexInfo,
  ProviderPluginPolicy,
  SaveProviderPluginPolicyInput,
} from '@/python/api';
import {
  addProviderPluginIndex,
  getProviderPluginPolicy,
  importProviderPlugin,
  installProviderPluginFromRepo,
  listProviderPluginIndexes,
  removeProviderPluginIndex,
  runProviderPluginUpdateCheck,
  saveProviderPluginPolicy,
} from '@/python/api';
import { getProviders } from './provider-registry';
import { useOptionalChat } from '@/contexts/chat-context';
import { useProviderCatalogData } from '@/lib/hooks/providers/use-provider-catalog-data';
import { useProviderConnectionActions } from '@/lib/hooks/providers/use-provider-connection-actions';
import { useProviderFiltering } from '@/lib/hooks/providers/use-provider-filtering';
import { useProviderOauthActions } from '@/lib/hooks/providers/use-provider-oauth-actions';
import type { ProviderConnectionStatus } from '@/lib/hooks/providers/types';

interface ProvidersPanelProps {
  onOpenStore?: () => void;
}

function PluginSettingsSection() {
  const [policy, setPolicy] = useState<ProviderPluginPolicy>({
    mode: 'safe',
    autoUpdateEnabled: false,
  });
  const [indexes, setIndexes] = useState<ProviderPluginIndexInfo[]>([]);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [isRunningUpdateCheck, setIsRunningUpdateCheck] = useState(false);
  const [indexName, setIndexName] = useState('');
  const [indexUrl, setIndexUrl] = useState('');
  const [isAddingIndex, setIsAddingIndex] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoRef, setRepoRef] = useState('main');
  const [repoPath, setRepoPath] = useState('');
  const [isInstallingRepo, setIsInstallingRepo] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [policyResp, indexesResp] = await Promise.all([
        getProviderPluginPolicy(),
        listProviderPluginIndexes(),
      ]);
      setPolicy(policyResp);
      setIndexes(indexesResp.indexes || []);
    } catch (error) {
      setErrorByKey({
        global: error instanceof Error ? error.message : 'Failed to load plugin settings',
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toPolicyInput = (next: ProviderPluginPolicy): SaveProviderPluginPolicyInput => ({
    mode: next.mode === 'unsafe' ? 'unsafe' : 'safe',
    autoUpdateEnabled: Boolean(next.autoUpdateEnabled),
  });

  const handleSavePolicy = async (next: ProviderPluginPolicy) => {
    setErrorByKey((prev) => ({ ...prev, policy: '' }));
    try {
      const saved = await saveProviderPluginPolicy({ body: toPolicyInput(next) });
      setPolicy(saved);
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        policy: error instanceof Error ? error.message : 'Failed to save policy',
      }));
    }
  };

  const handleRunUpdateCheck = async () => {
    setIsRunningUpdateCheck(true);
    setErrorByKey((prev) => ({ ...prev, update: '' }));
    try {
      await runProviderPluginUpdateCheck();
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        update: error instanceof Error ? error.message : 'Failed to run update check',
      }));
    } finally {
      setIsRunningUpdateCheck(false);
    }
  };

  const handleAddIndex = async () => {
    if (!indexName.trim() || !indexUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, index: 'Index name and URL are required' }));
      return;
    }
    setIsAddingIndex(true);
    setErrorByKey((prev) => ({ ...prev, index: '' }));
    try {
      await addProviderPluginIndex({ body: { name: indexName.trim(), url: indexUrl.trim() } });
      setIndexName('');
      setIndexUrl('');
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        index: error instanceof Error ? error.message : 'Failed to add index',
      }));
    } finally {
      setIsAddingIndex(false);
    }
  };

  const handleRemoveIndex = async (indexId: string) => {
    setErrorByKey((prev) => ({ ...prev, [`index:${indexId}`]: '' }));
    try {
      await removeProviderPluginIndex({ body: { id: indexId } });
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [`index:${indexId}`]: error instanceof Error ? error.message : 'Failed to remove index',
      }));
    }
  };

  const handleInstallRepo = async () => {
    if (!repoUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, repo: 'Repository URL is required' }));
      return;
    }
    setIsInstallingRepo(true);
    setErrorByKey((prev) => ({ ...prev, repo: '' }));
    try {
      await installProviderPluginFromRepo({
        body: {
          repoUrl: repoUrl.trim(),
          ref: repoRef.trim() || 'main',
          pluginPath: repoPath.trim() || undefined,
        },
      });
      setRepoUrl('');
      setRepoPath('');
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        repo: error instanceof Error ? error.message : 'Failed to install repo plugin',
      }));
    } finally {
      setIsInstallingRepo(false);
    }
  };

  const handleUploadZip = async (file: File | null) => {
    if (!file) return;
    setIsUploading(true);
    setErrorByKey((prev) => ({ ...prev, upload: '' }));
    try {
      await importProviderPlugin({ file }).promise;
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        upload: error instanceof Error ? error.message : 'Failed to upload plugin',
      }));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      {errorByKey.global && <p className="text-sm text-red-600">{errorByKey.global}</p>}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Safety &amp; Updates</h3>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.mode === 'unsafe'}
              onCheckedChange={(checked) => {
                void handleSavePolicy({ ...policy, mode: checked === true ? 'unsafe' : 'safe' });
              }}
            />
            Allow community plugins (unsafe mode)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.autoUpdateEnabled}
              onCheckedChange={(checked) => {
                void handleSavePolicy({ ...policy, autoUpdateEnabled: checked === true });
              }}
            />
            Auto-update plugins
          </label>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleRunUpdateCheck()}
          disabled={isRunningUpdateCheck}
        >
          {isRunningUpdateCheck ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" /> Checking...
            </>
          ) : (
            <>
              <RefreshCw className="mr-1.5 size-4" /> Check for updates
            </>
          )}
        </Button>
        {errorByKey.policy && <p className="text-xs text-red-600">{errorByKey.policy}</p>}
        {errorByKey.update && <p className="text-xs text-red-600">{errorByKey.update}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Community Indexes</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={indexName}
            onChange={(e) => setIndexName(e.target.value)}
            placeholder="Index name"
          />
          <Input
            value={indexUrl}
            onChange={(e) => setIndexUrl(e.target.value)}
            placeholder="https://example.com/provider-index.json"
            className="md:col-span-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleAddIndex()}
            disabled={isAddingIndex}
          >
            {isAddingIndex ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Adding...
              </>
            ) : (
              <>
                <Plus className="mr-1.5 size-4" /> Add index
              </>
            )}
          </Button>
          {errorByKey.index && <p className="text-xs text-red-600">{errorByKey.index}</p>}
        </div>
        {indexes.length > 0 && (
          <div className="space-y-2">
            {indexes.map((index) => (
              <div
                key={index.id}
                className="flex items-center justify-between text-sm border rounded p-2"
              >
                <div>
                  <div className="font-medium">{index.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {index.url} · {index.pluginCount} plugins
                  </div>
                </div>
                {!index.builtIn && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRemoveIndex(index.id)}
                  >
                    Remove
                  </Button>
                )}
                {errorByKey[`index:${index.id}`] && (
                  <p className="text-xs text-red-600">{errorByKey[`index:${index.id}`]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Install from GitHub</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="md:col-span-2"
          />
          <Input
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
            placeholder="ref (default: main)"
          />
          <Input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="Plugin path inside repo (optional)"
            className="md:col-span-3"
          />
        </div>
        <Button
          size="sm"
          onClick={() => void handleInstallRepo()}
          disabled={isInstallingRepo}
        >
          {isInstallingRepo ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" /> Installing...
            </>
          ) : (
            <>
              <Plug className="mr-1.5 size-4" /> Install
            </>
          )}
        </Button>
        {errorByKey.repo && <p className="text-xs text-red-600">{errorByKey.repo}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Upload Plugin ZIP</h3>
        <label className="inline-flex items-center">
          <input
            type="file"
            className="hidden"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isUploading}
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              void handleUploadZip(file);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" asChild>
            <span>
              {isUploading ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 size-4" /> Upload ZIP
                </>
              )}
            </span>
          </Button>
        </label>
        {errorByKey.upload && <p className="text-xs text-red-600">{errorByKey.upload}</p>}
      </div>
    </div>
  );
}

export default function ProvidersPanel({ onOpenStore }: ProvidersPanelProps) {
  const [search, setSearch] = useState('');
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage API keys and OAuth connections for each provider.
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Plugin settings"
              title="Plugin settings"
            >
              <Settings size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 max-h-[70vh] overflow-y-auto shadow-xl">
            <PluginSettingsSection />
          </PopoverContent>
        </Popover>
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
          onClick={onOpenStore}
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

    </div>
  );
}
