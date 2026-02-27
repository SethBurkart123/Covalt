"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  Plug,
  Trash2,
  AlertTriangle,
  Shield,
  Package,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  normalizeProviderPluginSourceClass,
  normalizeProviderPluginTrustStatus,
  getProviderPluginSourceLabel,
} from "@/lib/services/provider-plugin-trust";
import type {
  ProviderPluginInfo,
  ProviderPluginPolicy,
  ProviderPluginSourceInfo,
  SaveProviderPluginPolicyInput,
} from "@/python/api";
import {
  getProviderPluginPolicy,
  installProviderPluginSource,
  listProviderPlugins,
  listProviderPluginSources,
  saveProviderPluginPolicy,
  setProviderPluginAutoUpdate,
  uninstallProviderPlugin,
} from "@/python/api";

type StoreTab = "official" | "community" | "installed";

interface ProviderStorePanelProps {
  storeTab: StoreTab;
}

const normalize = (value: string): string => value.toLowerCase().trim();

function SourceCard({
  source,
  isInstalled,
  isInstalling,
  onInstall,
  error,
}: {
  source: ProviderPluginSourceInfo;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
  error?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-center size-10 rounded-lg bg-muted flex-shrink-0">
        <Plug className="size-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{source.name}</span>
          {isInstalled && (
            <span className="text-xs text-green-600 inline-flex items-center gap-1">
              <CheckCircle size={12} /> Installed
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {source.description}
        </p>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <Button
        size="sm"
        variant={isInstalled ? "secondary" : "default"}
        disabled={isInstalled || isInstalling}
        onClick={onInstall}
      >
        {isInstalling ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isInstalled ? (
          "Installed"
        ) : (
          "Install"
        )}
      </Button>
    </div>
  );
}

function InstalledPluginCard({
  plugin,
  isRemoving,
  onUninstall,
  onAutoUpdateChange,
  error,
  autoUpdateError,
}: {
  plugin: ProviderPluginInfo;
  isRemoving: boolean;
  onUninstall: () => void;
  onAutoUpdateChange: (override: "inherit" | "enabled" | "disabled") => void;
  error?: string;
  autoUpdateError?: string;
}) {
  const trustStatus = normalizeProviderPluginTrustStatus(plugin.verificationStatus);
  const sourceLabel = getProviderPluginSourceLabel(plugin.sourceType);
  const hasTrustIssue = trustStatus === "invalid" || trustStatus === "untrusted";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-center size-10 rounded-lg bg-muted flex-shrink-0 mt-0.5">
        <Package className="size-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{plugin.name}</span>
          {plugin.enabled ? (
            <span className="text-xs text-green-600 inline-flex items-center gap-1">
              <CheckCircle size={12} /> Enabled
            </span>
          ) : (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <XCircle size={12} /> Disabled
            </span>
          )}
          {hasTrustIssue && (
            <span className="text-xs text-amber-600 inline-flex items-center gap-1">
              <AlertTriangle size={12} />
              {trustStatus === "invalid" ? "Invalid signature" : "Untrusted signer"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{plugin.description}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {sourceLabel && (
            <span className="text-xs text-muted-foreground">{sourceLabel}</span>
          )}
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Auto-update:</Label>
            <select
              className="h-7 rounded border bg-background px-1.5 text-xs"
              value={
                plugin.autoUpdateOverride === "enabled" || plugin.autoUpdateOverride === "disabled"
                  ? plugin.autoUpdateOverride
                  : "inherit"
              }
              onChange={(event) =>
                onAutoUpdateChange(event.target.value as "inherit" | "enabled" | "disabled")
              }
            >
              <option value="inherit">Inherit</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>
        {plugin.error && <p className="text-xs text-red-600 mt-1">{plugin.error}</p>}
        {plugin.updateError && (
          <p className="text-xs text-red-600 mt-1">Update error: {plugin.updateError}</p>
        )}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        {autoUpdateError && <p className="text-xs text-red-600 mt-1">{autoUpdateError}</p>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={isRemoving}
        onClick={onUninstall}
      >
        {isRemoving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </div>
  );
}

function CommunityGate({
  isSaving,
  onEnableUnsafe,
}: {
  isSaving: boolean;
  onEnableUnsafe: () => void;
}) {
  const [riskChecked, setRiskChecked] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center max-w-lg mx-auto">
      <div className="flex items-center justify-center size-16 rounded-full bg-amber-500/10 mb-6">
        <Shield className="size-8 text-amber-500" />
      </div>
      <h2 className="text-lg font-semibold mb-3">Community Plugins</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Community plugins are created by third-party developers and are not reviewed by the Covalt
        team. They may contain arbitrary code that runs on your machine. Only install plugins from
        sources you trust.
      </p>
      <label className="inline-flex items-center gap-2 text-sm mb-4 cursor-pointer">
        <Checkbox
          checked={riskChecked}
          onCheckedChange={(checked) => setRiskChecked(checked === true)}
        />
        I understand the risks
      </label>
      <Button onClick={onEnableUnsafe} disabled={!riskChecked || isSaving}>
        {isSaving ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        ) : null}
        Enable community plugins
      </Button>
    </div>
  );
}

const TAB_TITLES: Record<StoreTab, { heading: string; description: string }> = {
  official: {
    heading: "Official Plugins",
    description: "Verified provider plugins maintained by the Covalt team.",
  },
  community: {
    heading: "Community Plugins",
    description: "Provider plugins created by third-party developers.",
  },
  installed: {
    heading: "Installed Plugins",
    description: "Manage your installed provider plugins.",
  },
};

export default function ProviderStorePanel({ storeTab }: ProviderStorePanelProps) {
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<ProviderPluginPolicy>({
    mode: "safe",
    autoUpdateEnabled: false,
  });
  const [sources, setSources] = useState<ProviderPluginSourceInfo[]>([]);
  const [installed, setInstalled] = useState<ProviderPluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [installingSourceId, setInstallingSourceId] = useState<string | null>(null);
  const [removingPluginId, setRemovingPluginId] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [policyResp, sourceResp, pluginsResp] = await Promise.all([
        getProviderPluginPolicy(),
        listProviderPluginSources(),
        listProviderPlugins(),
      ]);
      setPolicy(policyResp);
      setSources(sourceResp.sources || []);
      setInstalled(pluginsResp.plugins || []);
      setErrorByKey({});
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

  // Reset search when switching tabs
  useEffect(() => {
    setSearch("");
  }, [storeTab]);

  const installedById = useMemo(() => {
    const map = new Map<string, ProviderPluginInfo>();
    for (const item of installed) {
      map.set(item.id, item);
    }
    return map;
  }, [installed]);

  const filteredSources = useMemo(() => {
    const targetClass = storeTab === "official" ? "official" : "community";
    const term = normalize(search);
    return sources
      .filter((s) => normalizeProviderPluginSourceClass(s.sourceClass) === targetClass)
      .filter((s) => {
        if (!term) return true;
        return `${s.name} ${s.description} ${s.provider}`.toLowerCase().includes(term);
      });
  }, [sources, search, storeTab]);

  const filteredInstalled = useMemo(() => {
    const term = normalize(search);
    if (!term) return installed;
    return installed.filter((plugin) =>
      `${plugin.name} ${plugin.description} ${plugin.provider}`.toLowerCase().includes(term),
    );
  }, [search, installed]);

  const toPolicyInput = useCallback(
    (next: ProviderPluginPolicy): SaveProviderPluginPolicyInput => ({
      mode: next.mode === "unsafe" ? "unsafe" : "safe",
      autoUpdateEnabled: Boolean(next.autoUpdateEnabled),
    }),
    [],
  );

  const handleSavePolicy = useCallback(
    async (next: ProviderPluginPolicy) => {
      setIsSavingPolicy(true);
      setErrorByKey((prev) => ({ ...prev, policy: "" }));
      try {
        const saved = await saveProviderPluginPolicy({ body: toPolicyInput(next) });
        setPolicy(saved);
        await reload();
      } catch (error) {
        setErrorByKey((prev) => ({
          ...prev,
          policy: error instanceof Error ? error.message : "Failed to save plugin policy",
        }));
      } finally {
        setIsSavingPolicy(false);
      }
    },
    [reload, toPolicyInput],
  );

  const handleInstallSource = async (source: ProviderPluginSourceInfo) => {
    setInstallingSourceId(source.id);
    setErrorByKey((prev) => ({ ...prev, [source.id]: "" }));
    try {
      await installProviderPluginSource({ body: { id: source.id } });
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [source.id]: error instanceof Error ? error.message : "Failed to install",
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
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [plugin.id]: error instanceof Error ? error.message : "Failed to uninstall",
      }));
    } finally {
      setRemovingPluginId(null);
    }
  };

  const handlePluginAutoUpdateOverride = async (
    pluginId: string,
    override: "inherit" | "enabled" | "disabled",
  ) => {
    setErrorByKey((prev) => ({ ...prev, [`autoupdate:${pluginId}`]: "" }));
    try {
      await setProviderPluginAutoUpdate({ body: { id: pluginId, override } });
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        [`autoupdate:${pluginId}`]:
          error instanceof Error ? error.message : "Failed to update auto-update",
      }));
    }
  };

  const { heading, description } = TAB_TITLES[storeTab];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Community gate: show interstitial if unsafe mode is not enabled
  if (storeTab === "community" && policy.mode !== "unsafe") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <CommunityGate
          isSaving={isSavingPolicy}
          onEnableUnsafe={() =>
            void handleSavePolicy({ ...policy, mode: "unsafe" })
          }
        />
        {errorByKey.policy && (
          <p className="text-sm text-red-600 text-center">{errorByKey.policy}</p>
        )}
      </div>
    );
  }

  // Source browsing tabs (official / community)
  if (storeTab === "official" || storeTab === "community") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${storeTab} plugins...`}
            className="pl-8"
          />
        </div>
        {errorByKey.global && <p className="text-sm text-red-600">{errorByKey.global}</p>}
        {filteredSources.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {storeTab === "community"
              ? "No community plugins available. Add a community index on the Providers page to discover plugins."
              : "No official plugins available."}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                isInstalled={Boolean(installedById.get(source.pluginId))}
                isInstalling={installingSourceId === source.id}
                onInstall={() => void handleInstallSource(source)}
                error={errorByKey[source.id]}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Installed tab
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search installed plugins..."
          className="pl-8"
        />
      </div>
      {filteredInstalled.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <Package className="size-8 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-sm font-medium mb-1">No plugins installed</h3>
          <p className="text-xs text-muted-foreground">
            Browse official or community plugins to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredInstalled.map((plugin) => (
            <InstalledPluginCard
              key={plugin.id}
              plugin={plugin}
              isRemoving={removingPluginId === plugin.id}
              onUninstall={() => void handleUninstallPlugin(plugin)}
              onAutoUpdateChange={(override) =>
                void handlePluginAutoUpdateOverride(plugin.id, override)
              }
              error={errorByKey[plugin.id]}
              autoUpdateError={errorByKey[`autoupdate:${plugin.id}`]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
