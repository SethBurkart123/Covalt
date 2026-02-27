"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Upload, Loader2, CheckCircle, XCircle, Plug, Trash2, AlertTriangle } from "lucide-react";
import {
  TRUST_BADGE_LABEL,
  TRUST_BADGE_STYLE,
  getProviderPluginSourceLabel,
  isLocalProviderPluginSource,
  normalizeProviderPluginTrustStatus,
} from "@/lib/services/provider-plugin-trust";
import type { ProviderPluginInfo, ProviderPluginSourceInfo } from "@/python/api";
import {
  listProviderPlugins,
  listProviderPluginSources,
  installProviderPluginSource,
  importProviderPlugin,
  uninstallProviderPlugin,
} from "@/python/api";

interface ProviderStorePanelProps {
  onPluginsChanged?: () => Promise<void> | void;
  compact?: boolean;
}

const normalize = (value: string): string => value.toLowerCase().trim();

export default function ProviderStorePanel({ onPluginsChanged, compact = false }: ProviderStorePanelProps) {
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<ProviderPluginSourceInfo[]>([]);
  const [installed, setInstalled] = useState<ProviderPluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [installingSourceId, setInstallingSourceId] = useState<string | null>(null);
  const [removingPluginId, setRemovingPluginId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [installWarningBySourceId, setInstallWarningBySourceId] = useState<Record<string, string>>({});
  const [uploadWarning, setUploadWarning] = useState<string>("");

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourceResp, pluginsResp] = await Promise.all([
        listProviderPluginSources(),
        listProviderPlugins(),
      ]);
      setSources(sourceResp.sources || []);
      setInstalled(pluginsResp.plugins || []);
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
    reload();
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

  const headerClass = compact ? "text-lg" : "text-xl";

  return (
    <div className="space-y-5">
      <div>
        <h2 className={`${headerClass} font-semibold`}>Provider Store</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Install provider plugins. Installed providers appear in the main Providers list (disabled by default).
        </p>
      </div>

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
            return (
              <Card key={source.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {source.name}
                      {installedPlugin ? (
                        <span className="text-xs text-green-600 inline-flex items-center gap-1">
                          <CheckCircle size={12} /> Installed
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{source.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Provider: {source.provider}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={installedPlugin ? "secondary" : "default"}
                    disabled={Boolean(installedPlugin) || isInstalling}
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
                      <span className={`text-xs inline-flex items-center gap-1 ${trustClassName}`}>
                        {trustStatus === "verified" ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {trustLabel}
                      </span>
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
                    {plugin.signingKeyId ? (
                      <p className="text-xs text-muted-foreground mt-1">Signer: {plugin.signingKeyId}</p>
                    ) : null}
                    {plugin.verificationMessage ? (
                      <p className={`text-xs mt-1 ${trustStatus === "verified" ? "text-muted-foreground" : "text-amber-600"}`}>
                        {plugin.verificationMessage}
                      </p>
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
                {errorByKey[plugin.id] && <p className="text-xs text-red-600">{errorByKey[plugin.id]}</p>}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
