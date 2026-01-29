"use client";

import { Fragment, useState, useMemo, useEffect, memo } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

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
import { PROVIDER_MAP } from "@/(app)/(pages)/settings/providers/ProviderRegistry";
import { getRecentModels } from "@/lib/utils";
import { useChat } from "@/contexts/chat-context";
import { useFuzzyFilter } from "@/lib/hooks/use-fuzzy-filter";

interface ModelSelectorProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
}

const getModelKey = (model: ModelInfo) => `${model.provider}:${model.modelId}`;
const getProviderFromKey = (key: string) => key.split(":")[0];

function ModelSelector({
  selectedModel,
  setSelectedModel,
  models,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const { refreshModels } = useChat();

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) refreshModels();
  };

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(refreshModels, 7000);
    return () => clearInterval(interval);
  }, [open, refreshModels]);

  const groupedModels = useMemo(() => {
    const availableModels = new Map(models.map((m) => [getModelKey(m), m]));

    const recentModels = getRecentModels()
      .map((key) => availableModels.get(key))
      .filter((m): m is ModelInfo => m !== undefined);

    const providerGroups = new Map<string, ModelInfo[]>();
    for (const model of models) {
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
  }, [models]);

  const fuzzyItems = useMemo(
    () =>
      groupedModels.flatMap((group) =>
        group.models.map((model) => ({
          value: group.isRecent ? `recent:${model.modelId}` : model.modelId,
          searchText: `${PROVIDER_MAP[model.provider]?.name || model.provider} ${model.displayName} ${model.modelId}`,
        }))
      ),
    [groupedModels]
  );

  const selectedModelInfo = models.find((m) => getModelKey(m) === selectedModel);
  const selectedProviderDef = selectedModel
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
          {selectedModelInfo ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {selectedProviderDef && (
                <span className="shrink-0 flex items-center">
                  <selectedProviderDef.icon />
                </span>
              )}
              <span className="truncate">{selectedModelInfo.modelId}</span>
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
          <CommandInput placeholder="Search model..." />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
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
                          <span className="truncate">{model.modelId}</span>
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
