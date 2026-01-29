"use client";

import { Fragment, useId, useState, useMemo, useEffect, memo } from "react";
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

interface ModelSelectorProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
}

function getModelKey(model: ModelInfo): string {
  return `${model.provider}:${model.modelId}`;
}

function getProviderFromKey(modelKey: string): string {
  const colonIndex = modelKey.indexOf(":");
  return colonIndex !== -1 ? modelKey.slice(0, colonIndex) : modelKey;
}

function ModelSelector({
  selectedModel,
  setSelectedModel,
  models,
}: ModelSelectorProps) {
  const id = useId();
  const [open, setOpen] = useState<boolean>(false);
  const { refreshModels } = useChat();

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) refreshModels();
  };

  useEffect(() => {
    if (!open) return;

    const interval = setInterval(() => {
      refreshModels();
    }, 7000);

    return () => clearInterval(interval);
  }, [open, refreshModels]);

  const groupedModels = useMemo(() => {
    const recentModelKeys = getRecentModels();
    const availableModelsMap = new Map<string, ModelInfo>();

    for (const model of models) {
      availableModelsMap.set(getModelKey(model), model);
    }

    const recentModels = recentModelKeys
      .map((key) => availableModelsMap.get(key))
      .filter((model): model is ModelInfo => model !== undefined);

    const providerGroups = new Map<string, ModelInfo[]>();

    for (const model of models) {
      const provider = model.provider;
      if (!providerGroups.has(provider)) {
        providerGroups.set(provider, []);
      }
      providerGroups.get(provider)!.push(model);
    }

    const providerGroupList = Array.from(providerGroups.entries())
      .map(([provider, modelList]) => ({
        provider,
        models: modelList,
        providerDef: PROVIDER_MAP[provider],
        isRecent: false,
      }))
      .sort((a, b) => {
        const aName = a.providerDef?.name || a.provider;
        const bName = b.providerDef?.name || b.provider;
        return aName.localeCompare(bName);
      });

    const groups: Array<{
      provider: string;
      models: ModelInfo[];
      providerDef?: (typeof PROVIDER_MAP)[string];
      isRecent: boolean;
    }> = [];

    if (recentModels.length > 0) {
      groups.push({
        provider: "__recent__",
        models: recentModels,
        isRecent: true,
      });
    }

    groups.push(...providerGroupList);

    return groups;
  }, [models]);

  const selectedModelInfo = models.find((m) => getModelKey(m) === selectedModel);
  const selectedProvider = selectedModel ? getProviderFromKey(selectedModel) : null;
  const selectedProviderDef = selectedProvider ? PROVIDER_MAP[selectedProvider] : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
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
        <Command className="rounded-2xl">
          <CommandInput placeholder="Search model..." />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {groupedModels.map((group) => {
              const providerName = group.isRecent
                ? "Recent"
                : group.providerDef?.name || group.provider;

              return (
                <Fragment key={group.provider}>
                  <CommandGroup heading={providerName}>
                    {group.models.map((model) => {
                      const modelKey = getModelKey(model);
                      const ProviderIcon = PROVIDER_MAP[model.provider]?.icon;

                      return (
                        <CommandItem
                          key={group.isRecent ? `recent:${modelKey}` : modelKey}
                          value={group.isRecent ? `recent:${model.modelId}` : model.modelId}
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
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default memo(ModelSelector);
