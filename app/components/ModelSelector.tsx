
import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  memo,
} from "react";
import { Bot, CheckIcon, ChevronDownIcon, Star } from "lucide-react";
import Fuse from "fuse.js";

import { Button } from "@/components/ui/button";
import { Command, CommandInput, CommandItem } from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CachedImage, preloadImages } from "@/components/ui/cached-image";
import { VirtualizedCommandList } from "@/components/ui/virtualized-command-list";
import { Skeleton } from "@/components/ui/skeleton";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import type { ModelInfo } from "@/lib/types/chat";
import type { AgentInfo } from "@/python/api";
import { agentFileUrl } from "@/python/api";
import { getProviderMap } from "@/pages/settings/providers/provider-registry";
import { cn, getRecentModels } from "@/lib/utils";
import { useChat } from "@/contexts/chat-context";
import { OpenAIIcon } from "@/pages/settings/providers/provider-icons";
import type { ProviderDefinition } from "@/lib/types/provider-catalog";
import {
  getStarredModels,
  setStarredModels as setStarredModels_backend,
} from "@/python/api";

const toProviderId = (value: string): string =>
  value.toLowerCase().trim().replace(/-/g, "_");

const CUSTOM_PROVIDERS_STORAGE_KEY = "covalt:custom-providers";

function getCustomProviderNames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const entries: Array<{ id: string; name: string }> = JSON.parse(
      localStorage.getItem(CUSTOM_PROVIDERS_STORAGE_KEY) || "[]",
    );
    const map: Record<string, string> = {};
    for (const entry of entries) {
      map[entry.id] = entry.name;
    }
    return map;
  } catch {
    return {};
  }
}

function AgentIconSmall({ icon, agentId }: { icon?: string; agentId: string }) {
  if (icon?.startsWith("image:")) {
    return (
      <CachedImage
        src={agentFileUrl({ agentId, fileType: "icon" })}
        className="size-4 rounded object-cover"
      />
    );
  }
  if (icon?.startsWith("emoji:"))
    return <span className="text-sm leading-none">{icon.slice(6)}</span>;
  if (icon && !icon.includes(":"))
    return <span className="text-sm leading-none">{icon}</span>;
  return <Bot size={16} className="text-muted-foreground" />;
}

interface ModelSelectorProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: readonly ModelInfo[];
  hideAgents?: boolean;
  className?: string;
}

const getModelKey = (m: ModelInfo) => `${m.provider}:${m.modelId}`;
const AGENT_FILTER = "__agents__";
const STARRED_FILTER = "__starred__";
const ITEM_HEIGHT = 32;
const HEADING_HEIGHT = 28;
const MODEL_OPTION_CLASS =
  "group/model-item mx-2 hover:bg-accent/50 hover:text-accent-foreground transition-colors duration-100";
const STAR_BUTTON_CLASS =
  "ml-2 flex size-5 shrink-0 items-center justify-center rounded-sm transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type FlatRow =
  | { type: "heading"; label: string }
  | { type: "agent"; agent: AgentInfo; key: string }
  | {
      type: "model";
      model: ModelInfo;
      key: string;
      isRecent: boolean;
      ProviderIcon?: React.ComponentType;
    };

type ItemRow = Exclude<FlatRow, { type: "heading" }>;

interface FuzzyEntry {
  value: string;
  searchText: string;
  row: ItemRow;
}

function ModelSelector({
  selectedModel,
  setSelectedModel,
  models,
  hideAgents,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerMap, setProviderMap] = useState<
    Record<string, ProviderDefinition>
  >({});
  const [starredModels, setStarredModels] = useState<readonly string[]>([]);
  const { agents, refreshAgents, refreshModels } = useChat();

  const hasModels = models.length > 0;
  useEffect(() => {
    let cancelled = false;
    getProviderMap()
      .then((map) => {
        if (!cancelled) {
          setProviderMap(map);
        }
      })
      .catch((error) => {
        console.error("Failed to load provider map", error);
      });

    return () => {
      cancelled = true;
    };
  }, [hasModels]);

  useEffect(() => {
    preloadImages(
      agents
        .filter((a) => a.icon?.startsWith("image:"))
        .map((a) => agentFileUrl({ agentId: a.id, fileType: "icon" })),
    );
  }, [agents]);

  useEffect(() => {
    getStarredModels()
      .then((res) => setStarredModels(res.modelKeys))
      .catch((err) => console.error("Failed to load starred models", err));
  }, []);

  const handleToggleStar = useCallback((modelKey: string) => {
    setStarredModels((prev) => {
      const updated = prev.includes(modelKey)
        ? prev.filter((k) => k !== modelKey)
        : [modelKey, ...prev.filter((k) => k !== modelKey)];
      setStarredModels_backend({ body: { modelKeys: updated } }).catch((err) =>
        console.error("Failed to save starred models", err),
      );
      return updated;
    });
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSearch("");
      setTimeout(() => {
        refreshModels();
        if (!hideAgents) refreshAgents();
      }, 0);
    }
  };

  useEffect(() => {
    if (!open) return;
    const modelInterval = setInterval(refreshModels, 7000);
    const agentInterval = hideAgents ? null : setInterval(refreshAgents, 15000);
    return () => {
      clearInterval(modelInterval);
      if (agentInterval) clearInterval(agentInterval);
    };
  }, [open, refreshModels, refreshAgents, hideAgents]);

  const customProviderNames = useMemo(() => getCustomProviderNames(), []);

  const getProviderDef = useCallback(
    (provider: string) =>
      providerMap[toProviderId(provider)] || providerMap[provider] || null,
    [providerMap],
  );

  const getProviderDisplayName = useCallback(
    (provider: string): string => {
      const customName = customProviderNames[provider];
      if (customName) return customName;
      const def = getProviderDef(provider);
      return def?.name || provider;
    },
    [customProviderNames, getProviderDef],
  );

  const providers = useMemo(() => {
    const unique = [...new Set(models.map((m) => m.provider))];
    return unique
      .map((provider) => ({
        id: provider,
        name: getProviderDisplayName(provider),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [models, getProviderDisplayName]);

  const showAgents =
    !hideAgents && (!providerFilter || providerFilter === AGENT_FILTER);
  const starredSet = useMemo(() => new Set(starredModels), [starredModels]);

  const allEntries = useMemo((): FuzzyEntry[] => {
    const entries: FuzzyEntry[] = [];

    if (showAgents) {
      for (const agent of agents) {
        const key = `agent:${agent.id}`;
        entries.push({
          value: key,
          searchText: `agent ${agent.name} ${agent.description || ""}`,
          row: { type: "agent", agent, key },
        });
      }
    }

    if (providerFilter !== AGENT_FILTER) {
      const allAvailable = new Map(models.map((m) => [getModelKey(m), m]));

      const modelSearchText = (model: ModelInfo) => {
        const name = getProviderDisplayName(model.provider);
        return `${name} ${model.displayName} ${model.modelId}`;
      };

      const modelIcon = (model: ModelInfo) =>
        getProviderDef(model.provider)?.icon || OpenAIIcon;

      if (providerFilter === STARRED_FILTER) {
        for (const key of starredModels) {
          const model = allAvailable.get(key);
          if (!model) continue;
          entries.push({
            value: `starred:${model.modelId}`,
            searchText: modelSearchText(model),
            row: {
              type: "model",
              model,
              key: getModelKey(model),
              isRecent: false,
              ProviderIcon: modelIcon(model),
            },
          });
        }
        return entries;
      }

      const filtered = providerFilter
        ? models.filter((m) => m.provider === providerFilter)
        : models;
      const available = new Map(filtered.map((m) => [getModelKey(m), m]));

      if (!providerFilter) {
        for (const key of starredModels) {
          const model = available.get(key);
          if (!model) continue;
          entries.push({
            value: `starred:${model.modelId}`,
            searchText: modelSearchText(model),
            row: {
              type: "model",
              model,
              key: getModelKey(model),
              isRecent: false,
              ProviderIcon: modelIcon(model),
            },
          });
        }

        for (const model of getRecentModels()
          .map((k) => available.get(k))
          .filter((m): m is ModelInfo => !!m)) {
          if (starredSet.has(getModelKey(model))) continue;
          entries.push({
            value: `recent:${model.modelId}`,
            searchText: modelSearchText(model),
            row: {
              type: "model",
              model,
              key: getModelKey(model),
              isRecent: true,
              ProviderIcon: modelIcon(model),
            },
          });
        }
      }

      const groups = new Map<string, ModelInfo[]>();
      for (const model of filtered) {
        const group = groups.get(model.provider) || [];
        group.push(model);
        groups.set(model.provider, group);
      }

      for (const [, providerModels] of [...groups.entries()].sort((a, b) =>
        getProviderDisplayName(a[0]).localeCompare(
          getProviderDisplayName(b[0]),
        ),
      )) {
        for (const model of providerModels) {
          entries.push({
            value: model.modelId,
            searchText: modelSearchText(model),
            row: {
              type: "model",
              model,
              key: getModelKey(model),
              isRecent: false,
              ProviderIcon: modelIcon(model),
            },
          });
        }
      }
    }

    return entries;
  }, [
    models,
    agents,
    providerFilter,
    showAgents,
    getProviderDef,
    getProviderDisplayName,
    starredModels,
    starredSet,
  ]);

  const fuse = useMemo(
    () =>
      new Fuse(allEntries, {
        keys: ["searchText"],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
      }),
    [allEntries],
  );

  const filteredEntries = useMemo(
    () => (search ? fuse.search(search).map((r) => r.item) : allEntries),
    [search, fuse, allEntries],
  );

  const flatRows = useMemo((): FlatRow[] => {
    const rows: FlatRow[] = [];
    let lastGroup = "";

    for (const { value, row } of filteredEntries) {
      const group =
        row.type === "agent"
          ? "Agents"
          : value.startsWith("starred:")
            ? "Starred"
            : row.isRecent
              ? "Recent"
              : getProviderDisplayName(row.model.provider);

      if (group !== lastGroup) {
        rows.push({ type: "heading", label: group });
        lastGroup = group;
      }
      rows.push(row);
    }

    return rows;
  }, [filteredEntries, getProviderDisplayName]);

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedModel(key);
      setOpen(false);
    },
    [setSelectedModel],
  );

  const selectedModelInfo = models.find(
    (m) => getModelKey(m) === selectedModel,
  );
  const selectedAgent = selectedModel.startsWith("agent:")
    ? agents.find((a) => `agent:${a.id}` === selectedModel)
    : null;
  const selectedProvider = selectedModelInfo
    ? getProviderDef(selectedModelInfo.provider)
    : null;
  const SelectedProviderIcon = selectedProvider?.icon;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex !h-9 sm:!h-9 rounded-xl items-center gap-1.5 px-3 py-1 text-sm font-medium min-w-20 [&_:where(img,svg)]:!size-4 [&_:where(img,svg)]:!min-h-0 [&_:where(img,svg)]:!min-w-0",
            className,
          )}
        >
          {selectedAgent ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-4 shrink-0 flex items-center justify-center">
                <AgentIconSmall
                  icon={selectedAgent.icon}
                  agentId={selectedAgent.id}
                />
              </span>
              <span className="whitespace-nowrap">{selectedAgent.name}</span>
            </span>
          ) : selectedModelInfo ? (
            <span className="inline-flex items-center gap-1.5">
              {SelectedProviderIcon && (
                <span className="size-4 shrink-0 flex items-center justify-center">
                  <SelectedProviderIcon />
                </span>
              )}
              <span className="whitespace-nowrap">
                {selectedModelInfo.modelId}
              </span>
            </span>
          ) : models.length === 0 ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <span className="text-muted-foreground">Select model</span>
          )}
          <ChevronDownIcon
            size={16}
            className="shrink-0 text-muted-foreground/80"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-full min-w-[min(var(--radix-popper-available-width),40rem)] max-w-[min(var(--radix-popper-available-width),40rem)] overflow-hidden border border-border bg-secondary shadow-lg rounded-2xl p-0"
        align="start"
      >
        <Command
          className="rounded-2xl"
          shouldFilter={false}
          disablePointerSelection
        >
          <CommandInput
            placeholder="Search model or agent..."
            value={search}
            onValueChange={setSearch}
          />

          <div className="flex w-full min-w-0 max-w-full flex-nowrap gap-1 px-3 pt-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide">
            <FilterTab
              active={providerFilter === null}
              onClick={() => setProviderFilter(null)}
            >
              All
            </FilterTab>
            {starredModels.length > 0 && (
              <FilterTab
                active={providerFilter === STARRED_FILTER}
                onClick={() => setProviderFilter(STARRED_FILTER)}
              >
                Starred
              </FilterTab>
            )}
            {!hideAgents && agents.length > 0 && (
              <FilterTab
                active={providerFilter === AGENT_FILTER}
                onClick={() => setProviderFilter(AGENT_FILTER)}
              >
                Agents
              </FilterTab>
            )}
            {providers.map((provider) => (
              <FilterTab
                key={provider.id}
                active={providerFilter === provider.id}
                onClick={() => setProviderFilter(provider.id)}
              >
                {provider.name}
              </FilterTab>
            ))}
          </div>

          <VirtualizedCommandList
            items={flatRows}
            estimateSize={(i) =>
              flatRows[i].type === "heading" ? HEADING_HEIGHT : ITEM_HEIGHT
            }
            emptyMessage="No model found."
            className="pb-2 min-h-80"
          >
            {(row) => {
              if (row.type === "heading") {
                return (
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {row.label}
                  </div>
                );
              }

              if (row.type === "agent") {
                return (
                  <CommandItem
                    value={row.key}
                    onSelect={() => handleSelect(row.key)}
                    className={MODEL_OPTION_CLASS}
                  >
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="shrink-0 flex items-center">
                        <AgentIconSmall
                          icon={row.agent.icon}
                          agentId={row.agent.id}
                        />
                      </span>
                      <span className="truncate">{row.agent.name}</span>
                    </span>
                    {row.key === selectedModel && (
                      <CheckIcon size={16} className="ml-auto shrink-0" />
                    )}
                  </CommandItem>
                );
              }

              const isStarred = starredSet.has(row.key);

              return (
                <CommandItem
                  value={
                    row.isRecent
                      ? `recent:${row.model.modelId}`
                      : row.model.modelId
                  }
                  onSelect={() => handleSelect(row.key)}
                  className={MODEL_OPTION_CLASS}
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    {row.ProviderIcon && (
                      <span className="shrink-0 flex items-center">
                        <row.ProviderIcon />
                      </span>
                    )}
                    <MiddleTruncate
                      className="flex-1"
                      text={row.model.modelId}
                    />
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <ModelStarButton
                      isStarred={isStarred}
                      onToggle={() => handleToggleStar(row.key)}
                    />
                    {row.key === selectedModel && (
                      <CheckIcon size={16} className="shrink-0" />
                    )}
                  </span>
                </CommandItem>
              );
            }}
          </VirtualizedCommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ModelStarButton({
  isStarred,
  onToggle,
}: {
  isStarred: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      aria-label={isStarred ? "Unstar model" : "Star model"}
      className={cn(
        STAR_BUTTON_CLASS,
        isStarred
          ? "text-yellow-500 opacity-100"
          : "text-muted-foreground opacity-0 group-hover/model-item:opacity-100",
        "hit-area-1.5",
      )}
    >
      <Star
        className={cn(
          "size-3.5",
          isStarred && "fill-yellow-500 text-yellow-500",
        )}
      />
    </button>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1 text-[13px] font-medium rounded-lg transition-colors hit-area-0.5 hit-area-y-1",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default memo(ModelSelector);
