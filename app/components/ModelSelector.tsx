"use client";

import { useState, useMemo, useEffect, useCallback, memo, useRef, useLayoutEffect } from "react";
import { Bot, CheckIcon, ChevronDownIcon } from "lucide-react";
import Fuse from "fuse.js";

import { Button } from "@/components/ui/button";
import { Command, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CachedImage, preloadImages } from "@/components/ui/cached-image";
import { VirtualizedCommandList } from "@/components/ui/virtualized-command-list";
import type { ModelInfo } from "@/lib/types/chat";
import type { AgentInfo } from "@/python/api";
import { agentFileUrl } from "@/python/api";
import { PROVIDER_MAP } from "@/(app)/(pages)/settings/providers/ProviderRegistry";
import { getRecentModels } from "@/lib/utils";
import { useChat } from "@/contexts/chat-context";
import { cn } from "@/lib/utils";

function MiddleTruncate({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(text);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      container.textContent = text;
      if (container.scrollWidth <= container.clientWidth) {
        setTruncated(text);
        return;
      }

      let start = 0;
      let end = text.length;
      const ellipsis = "…";

      while (end - start > 2) {
        const mid = Math.floor((start + end) / 2);
        const half = Math.floor(mid / 2);
        container.textContent = text.slice(0, half) + ellipsis + text.slice(text.length - half);

        if (container.scrollWidth <= container.clientWidth) start = mid;
        else end = mid;
      }

      const half = Math.floor(start / 2);
      setTruncated(half > 0 ? text.slice(0, half) + ellipsis + text.slice(text.length - half) : ellipsis);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={containerRef} className={cn("block overflow-hidden whitespace-nowrap", className)}>
      {truncated}
    </span>
  );
}

function AgentIconSmall({ icon, agentId }: { icon?: string; agentId: string }) {
  if (icon?.startsWith("image:")) {
    return <CachedImage src={agentFileUrl({ agentId, fileType: "icon" })} className="size-4 rounded object-cover" />;
  }
  if (icon?.startsWith("emoji:")) return <span className="text-sm leading-none">{icon.slice(6)}</span>;
  if (icon && !icon.includes(":")) return <span className="text-sm leading-none">{icon}</span>;
  return <Bot size={16} className="text-muted-foreground" />;
}

interface ModelSelectorProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  hideAgents?: boolean;
  className?: string;
}

const getModelKey = (m: ModelInfo) => `${m.provider}:${m.modelId}`;
const getProviderFromKey = (key: string) => key.split(":")[0];
const AGENT_FILTER = "__agents__";
const ITEM_HEIGHT = 32;
const HEADING_HEIGHT = 28;
const MODEL_OPTION_CLASS = "mx-2 hover:bg-accent/50 hover:text-accent-foreground transition-colors duration-100";

type FlatRow =
  | { type: "heading"; label: string }
  | { type: "agent"; agent: AgentInfo; key: string }
  | { type: "model"; model: ModelInfo; key: string; isRecent: boolean; ProviderIcon?: React.ComponentType };

type ItemRow = Exclude<FlatRow, { type: "heading" }>;

interface FuzzyEntry {
  value: string;
  searchText: string;
  row: ItemRow;
}

function ModelSelector({ selectedModel, setSelectedModel, models, hideAgents, className }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { agents, refreshAgents, refreshModels } = useChat();

  useEffect(() => {
    preloadImages(
      agents
        .filter((a) => a.icon?.startsWith("image:"))
        .map((a) => agentFileUrl({ agentId: a.id, fileType: "icon" })),
    );
  }, [agents]);

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

  const providers = useMemo(() => {
    const unique = [...new Set(models.map((m) => m.provider))];
    return unique
      .map((p) => ({ id: p, name: PROVIDER_MAP[p]?.name || p }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [models]);

  const showAgents = !hideAgents && (!providerFilter || providerFilter === AGENT_FILTER);

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
      const filtered = providerFilter ? models.filter((m) => m.provider === providerFilter) : models;
      const available = new Map(filtered.map((m) => [getModelKey(m), m]));

      // Recent
      if (!providerFilter) {
        for (const model of getRecentModels().map((k) => available.get(k)).filter((m): m is ModelInfo => !!m)) {
          entries.push({
            value: `recent:${model.modelId}`,
            searchText: `${PROVIDER_MAP[model.provider]?.name || model.provider} ${model.displayName} ${model.modelId}`,
            row: { type: "model", model, key: getModelKey(model), isRecent: true, ProviderIcon: PROVIDER_MAP[model.provider]?.icon },
          });
        }
      }

      // By provider
      const groups = new Map<string, ModelInfo[]>();
      for (const model of filtered) {
        const g = groups.get(model.provider) || [];
        g.push(model);
        groups.set(model.provider, g);
      }

      for (const [provider, providerModels] of [...groups.entries()].sort((a, b) =>
        (PROVIDER_MAP[a[0]]?.name || a[0]).localeCompare(PROVIDER_MAP[b[0]]?.name || b[0]))
      ) {
        for (const model of providerModels) {
          entries.push({
            value: model.modelId,
            searchText: `${PROVIDER_MAP[provider]?.name || provider} ${model.displayName} ${model.modelId}`,
            row: { type: "model", model, key: getModelKey(model), isRecent: false, ProviderIcon: PROVIDER_MAP[provider]?.icon },
          });
        }
      }
    }

    return entries;
  }, [models, agents, providerFilter, showAgents]);

  const fuse = useMemo(
    () => new Fuse(allEntries, { keys: ["searchText"], threshold: 0.4, ignoreLocation: true, includeScore: true }),
    [allEntries],
  );

  const filteredEntries = useMemo(
    () => (search ? fuse.search(search).map((r) => r.item) : allEntries),
    [search, fuse, allEntries],
  );

  const flatRows = useMemo((): FlatRow[] => {
    const rows: FlatRow[] = [];
    let lastGroup = "";

    for (const { row } of filteredEntries) {
      const group = row.type === "agent" ? "Agents" : row.isRecent ? "Recent" : (PROVIDER_MAP[row.model.provider]?.name || row.model.provider);

      if (group !== lastGroup) {
        rows.push({ type: "heading", label: group });
        lastGroup = group;
      }
      rows.push(row);
    }

    return rows;
  }, [filteredEntries]);

  const handleSelect = useCallback(
    (key: string) => { setSelectedModel(key); setOpen(false); },
    [setSelectedModel],
  );

  const selectedModelInfo = models.find((m) => getModelKey(m) === selectedModel);
  const selectedAgent = selectedModel.startsWith("agent:") ? agents.find((a) => `agent:${a.id}` === selectedModel) : null;
  const SelectedProviderIcon = selectedModel && !selectedModel.startsWith("agent:") ? PROVIDER_MAP[getProviderFromKey(selectedModel)]?.icon : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          className={cn("flex flex-shrink-0 rounded-xl items-center gap-1.5 px-3 py-1 text-sm font-medium h-9 justify-between min-w-20", className)}
        >
          {selectedAgent ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 flex items-center">
                <AgentIconSmall icon={selectedAgent.icon} agentId={selectedAgent.id} />
              </span>
              <MiddleTruncate text={selectedAgent.name} />
            </span>
          ) : selectedModelInfo ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {SelectedProviderIcon && (
                <span className="shrink-0 flex items-center"><SelectedProviderIcon /></span>
              )}
              <MiddleTruncate text={selectedModelInfo.modelId} />
            </span>
          ) : (
            <span className="text-muted-foreground">Select model</span>
          )}
          <ChevronDownIcon size={16} className="shrink-0 text-muted-foreground/80" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-full min-w-[var(--radix-popper-anchor-width)] border border-border bg-secondary shadow-lg rounded-2xl p-0"
        align="start"
      >
        <Command className="rounded-2xl" shouldFilter={false} disablePointerSelection>
          <CommandInput placeholder="Search model or agent..." value={search} onValueChange={setSearch} />

          <div className="flex w-full min-w-0 max-w-full flex-nowrap gap-1 px-3 pt-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide">
            <FilterTab active={providerFilter === null} onClick={() => setProviderFilter(null)}>All</FilterTab>
            {!hideAgents && agents.length > 0 && (
              <FilterTab active={providerFilter === AGENT_FILTER} onClick={() => setProviderFilter(AGENT_FILTER)}>Agents</FilterTab>
            )}
            {providers.map((p) => (
              <FilterTab key={p.id} active={providerFilter === p.id} onClick={() => setProviderFilter(p.id)}>{p.name}</FilterTab>
            ))}
          </div>

          <VirtualizedCommandList
            items={flatRows}
            estimateSize={(i) => flatRows[i].type === "heading" ? HEADING_HEIGHT : ITEM_HEIGHT}
            emptyMessage="No model found."
            className="pb-2"
          >
            {(row) => {
              if (row.type === "heading") {
                return <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">{row.label}</div>;
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
                        <AgentIconSmall icon={row.agent.icon} agentId={row.agent.id} />
                      </span>
                      <span className="truncate">{row.agent.name}</span>
                    </span>
                    {row.key === selectedModel && <CheckIcon size={16} className="ml-auto shrink-0" />}
                  </CommandItem>
                );
              }

              return (
                <CommandItem
                  value={row.isRecent ? `recent:${row.model.modelId}` : row.model.modelId}
                  onSelect={() => handleSelect(row.key)}
                  className={MODEL_OPTION_CLASS}
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    {row.ProviderIcon && (
                      <span className="shrink-0 flex items-center"><row.ProviderIcon /></span>
                    )}
                    <MiddleTruncate text={row.model.modelId} />
                  </span>
                  {row.key === selectedModel && <CheckIcon size={16} className="ml-auto shrink-0" />}
                </CommandItem>
              );
            }}
          </VirtualizedCommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1 text-[13px] font-medium rounded-lg transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default memo(ModelSelector);
