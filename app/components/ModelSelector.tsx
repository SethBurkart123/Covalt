"use client";

import { Fragment, useState, useMemo, useEffect, useCallback, memo, useRef, useLayoutEffect } from "react";
import { Bot, CheckIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelInfo } from "@/lib/types/chat";
import type { AgentInfo } from "@/python/api";
import { listAgents, agentFileUrl } from "@/python/api";
import { PROVIDER_MAP } from "@/(app)/(pages)/settings/providers/ProviderRegistry";
import { getRecentModels } from "@/lib/utils";
import { useChat } from "@/contexts/chat-context";
import { useFuzzyFilter } from "@/lib/hooks/use-fuzzy-filter";
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
        const truncatedText = text.slice(0, half) + ellipsis + text.slice(text.length - half);
        container.textContent = truncatedText;
        
        if (container.scrollWidth <= container.clientWidth) {
          start = mid;
        } else {
          end = mid;
        }
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
  const [hasError, setHasError] = useState(false);

  if (icon?.startsWith("image:") && !hasError) {
    return (
      <img
        src={agentFileUrl({ agentId, fileType: "icon" })}
        className="size-4 rounded object-cover"
        alt=""
        onError={() => setHasError(true)}
      />
    );
  }

  if (icon?.startsWith("emoji:")) {
    return <span className="text-sm leading-none">{icon.slice(6)}</span>;
  }

  if (icon && !icon.includes(":")) {
    return <span className="text-sm leading-none">{icon}</span>;
  }

  return <Bot size={16} className="text-muted-foreground" />;
}

interface ModelSelectorProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  onAgentsLoaded?: (agents: AgentInfo[]) => void;
}

const getModelKey = (model: ModelInfo) => `${model.provider}:${model.modelId}`;
const getProviderFromKey = (key: string) => key.split(":")[0];
const AGENT_FILTER = "__agents__";

function ModelSelector({
  selectedModel,
  setSelectedModel,
  models,
  onAgentsLoaded,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const { refreshModels } = useChat();

  const refreshAgents = useCallback(() => {
    listAgents()
      .then((res) => {
        setAgents(res.agents);
        onAgentsLoaded?.(res.agents);
      })
      .catch(console.error);
  }, [onAgentsLoaded]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      refreshModels();
      refreshAgents();
    }
  };

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      refreshModels();
      refreshAgents();
    }, 7000);
    return () => clearInterval(interval);
  }, [open, refreshModels, refreshAgents]);

  const providers = useMemo(() => {
    const uniqueProviders = [...new Set(models.map((m) => m.provider))];
    return uniqueProviders
      .map((provider) => ({
        id: provider,
        name: PROVIDER_MAP[provider]?.name || provider,
        icon: PROVIDER_MAP[provider]?.icon,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [models]);

  const groupedModels = useMemo(() => {
    if (providerFilter === AGENT_FILTER) return [];

    const filteredModels = providerFilter
      ? models.filter((m) => m.provider === providerFilter)
      : models;

    const availableModels = new Map(filteredModels.map((m) => [getModelKey(m), m]));

    const recentModels = providerFilter
      ? []
      : getRecentModels()
          .map((key) => availableModels.get(key))
          .filter((m): m is ModelInfo => m !== undefined);

    const providerGroups = new Map<string, ModelInfo[]>();
    for (const model of filteredModels) {
      const group = providerGroups.get(model.provider) || [];
      group.push(model);
      providerGroups.set(model.provider, group);
    }

    const sortedProviderGroups = Array.from(providerGroups.entries())
      .map(([provider, models]) => ({
        provider,
        models,
        providerDef: PROVIDER_MAP[provider],
        isRecent: false,
      }))
      .sort((a, b) => {
        const aName = a.providerDef?.name || a.provider;
        const bName = b.providerDef?.name || b.provider;
        return aName.localeCompare(bName);
      });

    return [
      ...(recentModels.length > 0
        ? [{ provider: "__recent__", models: recentModels, providerDef: undefined, isRecent: true }]
        : []),
      ...sortedProviderGroups,
    ];
  }, [models, providerFilter]);

  const showAgents = !providerFilter || providerFilter === AGENT_FILTER;

  const fuzzyItems = useMemo(() => {
    const modelItems = groupedModels.flatMap((group) =>
      group.models.map((model) => ({
        value: group.isRecent ? `recent:${model.modelId}` : model.modelId,
        searchText: `${PROVIDER_MAP[model.provider]?.name || model.provider} ${model.displayName} ${model.modelId}`,
      }))
    );

    const agentItems = showAgents
      ? agents.map((agent) => ({
          value: `agent:${agent.id}`,
          searchText: `agent ${agent.name} ${agent.description || ""}`,
        }))
      : [];

    return [...agentItems, ...modelItems];
  }, [groupedModels, agents, showAgents]);

  const selectedModelInfo = models.find((m) => getModelKey(m) === selectedModel);
  const selectedAgent = selectedModel.startsWith("agent:")
    ? agents.find((a) => `agent:${a.id}` === selectedModel)
    : null;
  const selectedProviderDef = selectedModel && !selectedModel.startsWith("agent:")
    ? PROVIDER_MAP[getProviderFromKey(selectedModel)]
    : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          className="flex flex-shrink-0 rounded-xl items-center gap-1.5 px-3 py-1 text-sm font-medium h-9 justify-between min-w-20"
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
              {selectedProviderDef && (
                <span className="shrink-0 flex items-center">
                  <selectedProviderDef.icon />
                </span>
              )}
              <MiddleTruncate text={selectedModelInfo.modelId} />
            </span>
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
        className="w-full min-w-[var(--radix-popper-anchor-width)] border border-border bg-secondary shadow-lg rounded-2xl p-0"
        align="start"
      >
        <Command className="rounded-2xl" filter={useFuzzyFilter(fuzzyItems)}>
          <CommandInput placeholder="Search model or agent..." />
          <div className="flex gap-1 px-3 pt-2 py-1 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setProviderFilter(null)}
              className={cn(
                "shrink-0 px-3 py-1 text-[13px] font-medium rounded-lg transition-colors",
                providerFilter === null
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50 text-muted-foreground"
              )}
            >
              All
            </button>
            {agents.length > 0 && (
              <button
                onClick={() => setProviderFilter(AGENT_FILTER)}
                className={cn(
                  "shrink-0 px-3 py-1 text-[13px] font-medium rounded-lg transition-colors",
                  providerFilter === AGENT_FILTER
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-muted-foreground"
                )}
              >
                Agents
              </button>
            )}
            {providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => setProviderFilter(provider.id)}
                className={cn(
                  "shrink-0 px-3 py-1 text-[13px] font-medium rounded-lg transition-colors",
                  providerFilter === provider.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-muted-foreground"
                )}
              >
                {provider.name}
              </button>
            ))}
          </div>
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {showAgents && agents.length > 0 && (
              <CommandGroup heading="Agents">
                {agents.map((agent) => {
                  const agentKey = `agent:${agent.id}`;
                  return (
                    <CommandItem
                      key={agentKey}
                      value={agentKey}
                      onSelect={() => {
                        setSelectedModel(agentKey);
                        setOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="shrink-0 flex items-center">
                          <AgentIconSmall icon={agent.icon} agentId={agent.id} />
                        </span>
                        <span className="truncate">{agent.name}</span>
                      </span>
                      {agentKey === selectedModel && (
                        <CheckIcon size={16} className="ml-auto shrink-0" />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {groupedModels.map((group) => (
              <Fragment key={group.provider}>
                <CommandGroup
                  heading={
                    group.isRecent
                      ? "Recent"
                      : group.providerDef?.name || group.provider
                  }
                >
                  {group.models.map((model) => {
                    const modelKey = getModelKey(model);
                    const ProviderIcon = PROVIDER_MAP[model.provider]?.icon;

                    return (
                      <CommandItem
                        key={group.isRecent ? `recent:${modelKey}` : modelKey}
                        value={
                          group.isRecent
                            ? `recent:${model.modelId}`
                            : model.modelId
                        }
                        onSelect={() => {
                          setSelectedModel(modelKey);
                          setOpen(false);
                        }}
                      >
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          {ProviderIcon && (
                            <span className="shrink-0 flex items-center">
                              <ProviderIcon />
                            </span>
                          )}
                          <MiddleTruncate text={model.modelId} />
                        </span>
                        {modelKey === selectedModel && (
                          <CheckIcon size={16} className="ml-auto shrink-0" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default memo(ModelSelector);
