"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Search, Upload, Loader2, CheckCircle, XCircle, Plug, Trash2, AlertTriangle, Shield, RefreshCw, Plus } from "lucide-react";
import {
  SOURCE_CLASS_BADGE_LABEL,
  SOURCE_CLASS_BADGE_STYLE,
  TRUST_BADGE_LABEL,
  TRUST_BADGE_STYLE,
  getProviderPluginSourceLabel,
  isLocalProviderPluginSource,
  normalizeProviderPluginSourceClass,
  normalizeProviderPluginTrustStatus,
} from "@/lib/services/provider-plugin-trust";
import type {
  ProviderPluginIndexInfo,
  ProviderPluginInfo,
  ProviderPluginPolicy,
  ProviderPluginSourceInfo,
  SaveProviderPluginPolicyInput,
} from "@/python/api";
import {
  addProviderPluginIndex,
  getProviderPluginPolicy,
  installProviderPluginFromRepo,
  installProviderPluginSource,
  importProviderPlugin,
  listProviderPluginIndexes,
  listProviderPlugins,
  listProviderPluginSources,
  removeProviderPluginIndex,
  runProviderPluginUpdateCheck,
  saveProviderPluginPolicy,
  setProviderPluginAutoUpdate,
  uninstallProviderPlugin,
} from "@/python/api";

interface ProviderStorePanelProps {
  onPluginsChanged?: () => Promise<void> | void;
  compact?: boolean;
}

const normalize = (value: string): string => value.toLowerCase().trim();

export default function ProviderStorePanel({ onPluginsChanged, compact = false }: ProviderStorePanelProps) {
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<ProviderPluginPolicy>({
    mode: "safe",
    autoUpdateEnabled: false,
    communityWarningAccepted: false,
  });
  const [sources, setSources] = useState<ProviderPluginSourceInfo[]>([]);
  const [indexes, setIndexes] = useState<ProviderPluginIndexInfo[]>([]);
  const [installed, setInstalled] = useState<ProviderPluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [installingSourceId, setInstallingSourceId] = useState<string | null>(null);
  const [removingPluginId, setRemovingPluginId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [installWarningBySourceId, setInstallWarningBySourceId] = useState<Record<string, string>>({});
  const [uploadWarning, setUploadWarning] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("main");
  const [repoPath, setRepoPath] = useState("");
  const [isInstallingRepo, setIsInstallingRepo] = useState(false);
  const [indexName, setIndexName] = useState("");
  const [indexUrl, setIndexUrl] = useState("");
  const [isAddingIndex, setIsAddingIndex] = useState(false);
  const [isRunningUpdateCheck, setIsRunningUpdateCheck] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [policyResp, sourceResp, pluginsResp, indexesResp] = await Promise.all([
        getProviderPluginPolicy(),
        listProviderPluginSources(),
        listProviderPlugins(),
        listProviderPluginIndexes(),
      ]);
      setPolicy(policyResp);
      setSources(sourceResp.sources || []);
      setInstalled(pluginsResp.plugins || []);
      setIndexes(indexesResp.indexes || []);
      setErrorByKey({});
      setUploadWarning("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load provider store";
      setErrorByKey({ global: message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const installedById = useMemo(() => {
    const map = new Map<string, ProviderPluginInfo>();
    for (const item of installed) {
      map.set(item.id, item);
    }
    return map;
  }, [installed]);

  const filteredSources = useMemo(() => {
    const term = normalize(search);
    if (!term) return sources;
    return sources.filter((source) => {
      const haystack = `${source.name} ${source.description} ${source.provider}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, sources]);

  const filteredInstalled = useMemo(() => {
    const term = normalize(search);
    if (!term) return installed;
    return installed.filter((plugin) => {
      const haystack = `${plugin.name} ${plugin.description} ${plugin.provider}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, installed]);

  const refreshAll = useCallback(async () => {
    await reload();
    await onPluginsChanged?.();
  }, [onPluginsChanged, reload]);

  const toPolicyInput = useCallback((next: ProviderPluginPolicy): SaveProviderPluginPolicyInput => ({
    mode: next.mode === "unsafe" ? "unsafe" : "safe",
    autoUpdateEnabled: Boolean(next.autoUpdateEnabled),
    communityWarningAccepted: Boolean(next.communityWarningAccepted),
  }), []);

  const handleSavePolicy = useCallback(
    async (next: ProviderPluginPolicy) => {
      setErrorByKey((prev) => ({ ...prev, policy: "" }));
      try {
        const saved = await saveProviderPluginPolicy({ body: toPolicyInput(next) });
        setPolicy(saved);
        await refreshAll();
      } catch (error) {
        setErrorByKey((prev) => ({
          ...prev,
          policy: error instanceof Error ? error.message : "Failed to save plugin policy",
        }));
      }
    },
    [refreshAll, toPolicyInput]
  );

  const handleInstallSource = async (source: ProviderPluginSourceInfo) => {
    setInstallingSourceId(source.id);
    setErrorByKey((prev) => ({ ...prev, [source.id]: "" }));
    setInstallWarningBySourceId((prev) => ({ ...prev, [source.id]: "" }));
    try {
      const result = await installProviderPluginSource({ body: { id: source.id } });
      if (result.verificationStatus !== "verified") {
        const warning = result.verificationMessage || "Plugin installed with trust warnings.";
        setInstallWarningBySourceId((prev) => ({ ...prev, [source.id]: warning }));
      }
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [source.id]: error instanceof Error ? error.message : "Failed to install source",
      }));
    } finally {
      setInstallingSourceId(null);
    }
  };

  const handleInstallRepo = async () => {
    if (!repoUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, repo: "Repository URL is required" }));
      return;
    }

    setIsInstallingRepo(true);
    setErrorByKey((prev) => ({ ...prev, repo: "" }));
    try {
      await installProviderPluginFromRepo({
        body: {
          repoUrl: repoUrl.trim(),
          ref: repoRef.trim() || "main",
          pluginPath: repoPath.trim() || undefined,
        },
      });
      setRepoUrl("");
      setRepoPath("");
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        repo: error instanceof Error ? error.message : "Failed to install repository plugin",
      }));
    } finally {
      setIsInstallingRepo(false);
    }
  };

  const handleUninstallPlugin = async (plugin: ProviderPluginInfo) => {
    setRemovingPluginId(plugin.id);
    setErrorByKey((prev) => ({ ...prev, [plugin.id]: "" }));
    try {
      await uninstallProviderPlugin({ body: { id: plugin.id } });
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [plugin.id]: error instanceof Error ? error.message : "Failed to uninstall plugin",
      }));
    } finally {
      setRemovingPluginId(null);
    }
  };

  const handleUploadZip = async (file: File | null) => {
    if (!file) return;
    setIsUploading(true);
    setErrorByKey((prev) => ({ ...prev, upload: "" }));
    setUploadWarning("");
    try {
      const result = await importProviderPlugin({ file }).promise;
      if (result.verificationStatus !== "verified") {
        setUploadWarning(result.verificationMessage || "Plugin uploaded with trust warnings.");
      }
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        upload: error instanceof Error ? error.message : "Failed to upload plugin",
      }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddIndex = async () => {
    if (!indexName.trim() || !indexUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, index: "Index name and URL are required" }));
      return;
    }
    setIsAddingIndex(true);
    setErrorByKey((prev) => ({ ...prev, index: "" }));
    try {
      await addProviderPluginIndex({ body: { name: indexName.trim(), url: indexUrl.trim() } });
      setIndexName("");
      setIndexUrl("");
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        index: error instanceof Error ? error.message : "Failed to add index",
      }));
    } finally {
      setIsAddingIndex(false);
    }
  };

  const handleRemoveIndex = async (indexId: string) => {
    setErrorByKey((prev) => ({ ...prev, [`index:${indexId}`]: "" }));
    try {
      await removeProviderPluginIndex({ body: { id: indexId } });
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [`index:${indexId}`]: error instanceof Error ? error.message : "Failed to remove index",
      }));
    }
  };

  const handleRunUpdateCheck = async () => {
    setIsRunningUpdateCheck(true);
    setErrorByKey((prev) => ({ ...prev, update: "" }));
    try {
      await runProviderPluginUpdateCheck();
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        update: error instanceof Error ? error.message : "Failed to run update check",
      }));
    } finally {
      setIsRunningUpdateCheck(false);
    }
  };

  const handlePluginAutoUpdateOverride = async (
    pluginId: string,
    override: "inherit" | "enabled" | "disabled"
  ) => {
    setErrorByKey((prev) => ({ ...prev, [`autoupdate:${pluginId}`]: "" }));
    try {
      await setProviderPluginAutoUpdate({
        body: {
          id: pluginId,
          override,
        },
      });
      await refreshAll();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [`autoupdate:${pluginId}`]:
          error instanceof Error ? error.message : "Failed to update auto-update override",
      }));
    }
  };

  const headerClass = compact ? "text-lg" : "text-xl";

  return (
    <div className="space-y-5">
      <div>
        <h2 className={`${headerClass} font-semibold`}>Provider Store</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Install provider plugins. Installed providers appear in the main Providers list (disabled by default).
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="size-4" />
          <h3 className="font-medium">Plugin Safety</h3>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.mode === "unsafe"}
              onCheckedChange={(checked) => {
                const enableUnsafe = checked === true;
                void handleSavePolicy({
                  ...policy,
                  mode: enableUnsafe ? "unsafe" : "safe",
                  communityWarningAccepted: enableUnsafe
                    ? policy.communityWarningAccepted
                    : policy.communityWarningAccepted,
                });
              }}
            />
            Unsafe mode (allow community plugins)
          </label>

          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.autoUpdateEnabled}
              onCheckedChange={(checked) => {
                void handleSavePolicy({
                  ...policy,
                  autoUpdateEnabled: checked === true,
                });
              }}
            />
            Global auto-update
          </label>

          {policy.mode === "unsafe" ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={policy.communityWarningAccepted}
                onCheckedChange={(checked) => {
                  void handleSavePolicy({
                    ...policy,
                    communityWarningAccepted: checked === true,
                  });
                }}
              />
              I understand community plugin risk
            </label>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleRunUpdateCheck()} disabled={isRunningUpdateCheck}>
            {isRunningUpdateCheck ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Checking...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 size-4" /> Run update check
              </>
            )}
          </Button>
          {errorByKey.policy ? <p className="text-xs text-red-600">{errorByKey.policy}</p> : null}
          {errorByKey.update ? <p className="text-xs text-red-600">{errorByKey.update}</p> : null}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Community Indexes</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input value={indexName} onChange={(event) => setIndexName(event.target.value)} placeholder="Index name" />
          <Input value={indexUrl} onChange={(event) => setIndexUrl(event.target.value)} placeholder="https://example.com/provider-index.json" className="md:col-span-2" />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleAddIndex()} disabled={isAddingIndex}>
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
          {errorByKey.index ? <p className="text-xs text-red-600">{errorByKey.index}</p> : null}
        </div>

        <div className="space-y-2">
          {indexes.map((index) => (
            <div key={index.id} className="flex items-center justify-between text-sm border rounded p-2">
              <div>
                <div className="font-medium">{index.name}</div>
                <div className="text-xs text-muted-foreground">{index.url} · {index.pluginCount} plugins</div>
              </div>
              {!index.builtIn ? (
                <Button size="sm" variant="ghost" onClick={() => void handleRemoveIndex(index.id)}>Remove</Button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Install from GitHub Repository</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            className="md:col-span-2"
          />
          <Input value={repoRef} onChange={(event) => setRepoRef(event.target.value)} placeholder="ref (default: main)" />
          <Input
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="plugin path inside repo (optional)"
            className="md:col-span-3"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void handleInstallRepo()} disabled={isInstallingRepo}>
            {isInstallingRepo ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Installing...
              </>
            ) : (
              <>
                <Plug className="mr-1.5 size-4" /> Install repo plugin
              </>
            )}
          </Button>
          {errorByKey.repo ? <p className="text-xs text-red-600">{errorByKey.repo}</p> : null}
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search store and installed plugins..."
            className="pl-8"
          />
        </div>
        <label className="inline-flex items-center">
          <input
            type="file"
            className="hidden"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleUploadZip(file);
              event.target.value = "";
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
      </div>

      {errorByKey.global && <p className="text-sm text-red-600">{errorByKey.global}</p>}
      {errorByKey.upload && <p className="text-sm text-red-600">{errorByKey.upload}</p>}
      {uploadWarning && <p className="text-sm text-amber-600">{uploadWarning}</p>}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Store Sources</h3>
        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading provider store...</Card>
        ) : filteredSources.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No matching store sources.</Card>
        ) : (
          filteredSources.map((source) => {
            const installedPlugin = installedById.get(source.pluginId);
            const isInstalling = installingSourceId === source.id;
            const sourceClass = normalizeProviderPluginSourceClass(source.sourceClass);
            const sourceClassLabel = SOURCE_CLASS_BADGE_LABEL[sourceClass];
            const sourceClassStyle = SOURCE_CLASS_BADGE_STYLE[sourceClass];
            const blocked = Boolean(source.blockedByPolicy);
            const warningRequired = Boolean(source.requiresCommunityWarning);
            const installDisabled = Boolean(installedPlugin) || isInstalling || blocked || warningRequired;

            return (
              <Card key={source.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium flex flex-wrap items-center gap-2">
                      {source.name}
                      <span className={`text-xs ${sourceClassStyle}`}>{sourceClassLabel}</span>
                      {installedPlugin ? (
                        <span className="text-xs text-green-600 inline-flex items-center gap-1">
                          <CheckCircle size={12} /> Installed
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{source.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Provider: {source.provider}</p>
                    {source.indexName ? (
                      <p className="text-xs text-muted-foreground mt-1">Index: {source.indexName}</p>
                    ) : null}
                    {source.repoUrl ? (
                      <p className="text-xs text-muted-foreground mt-1 break-all">Repo: {source.repoUrl}</p>
                    ) : null}
                    {blocked ? (
                      <p className="text-xs text-amber-600 mt-1">Blocked in Safe mode. Switch to Unsafe mode to install.</p>
                    ) : null}
                    {warningRequired ? (
                      <p className="text-xs text-amber-600 mt-1">Acknowledge the community plugin warning before installing.</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={installedPlugin ? "secondary" : "default"}
                    disabled={installDisabled}
                    onClick={() => void handleInstallSource(source)}
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" /> Installing...
                      </>
                    ) : installedPlugin ? (
                      <>
                        <CheckCircle className="mr-1.5 size-4" /> Installed
                      </>
                    ) : (
                      <>
                        <Plug className="mr-1.5 size-4" /> Install
                      </>
                    )}
                  </Button>
                </div>
                {errorByKey[source.id] && <p className="text-xs text-red-600">{errorByKey[source.id]}</p>}
                {installWarningBySourceId[source.id] && (
                  <p className="text-xs text-amber-600">{installWarningBySourceId[source.id]}</p>
                )}
              </Card>
            );
          })
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Installed Plugins</h3>
        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading installed plugins...</Card>
        ) : filteredInstalled.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No installed plugins yet.</Card>
        ) : (
          filteredInstalled.map((plugin) => {
            const isRemoving = removingPluginId === plugin.id;
            const trustStatus = normalizeProviderPluginTrustStatus(plugin.verificationStatus);
            const trustLabel = TRUST_BADGE_LABEL[trustStatus];
            const trustClassName = TRUST_BADGE_STYLE[trustStatus];
            const sourceClass = normalizeProviderPluginSourceClass(plugin.sourceClass);
            const sourceClassLabel = SOURCE_CLASS_BADGE_LABEL[sourceClass];
            const sourceClassClassName = SOURCE_CLASS_BADGE_STYLE[sourceClass];
            const sourceLabel = getProviderPluginSourceLabel(plugin.sourceType);
            const sourceIsLocal = isLocalProviderPluginSource(plugin.sourceType);

            return (
              <Card key={plugin.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium flex flex-wrap items-center gap-2">
                      {plugin.name}
                      {plugin.error ? (
                        <span className="text-xs text-amber-600 inline-flex items-center gap-1">
                          <AlertTriangle size={12} /> Warning
                        </span>
                      ) : null}
                      <span className={`text-xs inline-flex items-center gap-1 ${sourceClassClassName}`}>
                        {sourceClassLabel}
                      </span>
                      <span className={`text-xs inline-flex items-center gap-1 ${trustClassName}`}>
                        {trustStatus === "verified" ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {trustLabel}
                      </span>
                      {plugin.blockedByPolicy ? (
                        <span className="text-xs text-amber-600 inline-flex items-center gap-1">
                          <AlertTriangle size={12} /> Blocked by Safe mode
                        </span>
                      ) : null}
                      {plugin.enabled ? (
                        <span className="text-xs text-green-600 inline-flex items-center gap-1">
                          <CheckCircle size={12} /> Enabled
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <XCircle size={12} /> Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{plugin.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Provider: {plugin.provider}</p>
                    {sourceLabel ? (
                      <p className="text-xs text-muted-foreground mt-1">Source: {sourceLabel}</p>
                    ) : null}
                    {plugin.indexId ? (
                      <p className="text-xs text-muted-foreground mt-1">Index ID: {plugin.indexId}</p>
                    ) : null}
                    {plugin.repoUrl ? (
                      <p className="text-xs text-muted-foreground mt-1 break-all">Repo: {plugin.repoUrl}</p>
                    ) : null}
                    {plugin.trackingRef ? (
                      <p className="text-xs text-muted-foreground mt-1">Tracking ref: {plugin.trackingRef}</p>
                    ) : null}
                    {plugin.signingKeyId ? (
                      <p className="text-xs text-muted-foreground mt-1">Signer: {plugin.signingKeyId}</p>
                    ) : null}
                    {plugin.verificationMessage ? (
                      <p className={`text-xs mt-1 ${trustStatus === "verified" ? "text-muted-foreground" : "text-amber-600"}`}>
                        {plugin.verificationMessage}
                      </p>
                    ) : null}
                    {plugin.updateError ? (
                      <p className="text-xs text-red-600 mt-1">Last update error: {plugin.updateError}</p>
                    ) : null}
                    {sourceIsLocal ? (
                      <p className="text-xs text-amber-600 mt-1">
                        Local directory imports are allowed for development and should be reviewed before enabling.
                      </p>
                    ) : null}
                    {plugin.error ? <p className="text-xs text-red-600 mt-1">{plugin.error}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isRemoving}
                      onClick={() => void handleUninstallPlugin(plugin)}
                    >
                      {isRemoving ? (
                        <>
                          <Loader2 className="mr-1.5 size-4 animate-spin" /> Removing...
                        </>
                      ) : (
                        <>
                          <Trash2 className="mr-1.5 size-4" /> Uninstall
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Label className="text-xs text-muted-foreground">Auto-update</Label>
                  <select
                    className="h-8 rounded border bg-background px-2 text-sm"
                    value={
                      plugin.autoUpdateOverride === "enabled" || plugin.autoUpdateOverride === "disabled"
                        ? plugin.autoUpdateOverride
                        : "inherit"
                    }
                    onChange={(event) =>
                      void handlePluginAutoUpdateOverride(
                        plugin.id,
                        event.target.value as "inherit" | "enabled" | "disabled"
                      )
                    }
                  >
                    <option value="inherit">Inherit global</option>
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <span className="text-xs text-muted-foreground">
                    Effective: {plugin.effectiveAutoUpdate ? "On" : "Off"}
                  </span>
                </div>

                {errorByKey[plugin.id] && <p className="text-xs text-red-600">{errorByKey[plugin.id]}</p>}
                {errorByKey[`autoupdate:${plugin.id}`] && (
                  <p className="text-xs text-red-600">{errorByKey[`autoupdate:${plugin.id}`]}</p>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
