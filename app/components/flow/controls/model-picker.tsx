'use client';

import { useState, useMemo, Fragment } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModels } from '@/lib/hooks/useModels';
import { PROVIDER_MAP } from '@/(app)/(pages)/settings/providers/ProviderRegistry';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useFuzzyFilter } from '@/lib/hooks/use-fuzzy-filter';
import type { ControlProps } from './';

interface ModelPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;  // "provider:modelId" format
  onChange: (value: string) => void;
}

/**
 * Model picker control using the app's existing model system.
 */
export function ModelPicker({ value, onChange, compact }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const { models, isLoading } = useModels();
  
  const selectedModel = value ?? '';
  const [selectedProvider, selectedModelId] = selectedModel.split(':');
  
  // Group models by provider
  const groupedModels = useMemo(() => {
    const providerGroups = new Map<string, typeof models>();
    for (const model of models) {
      const group = providerGroups.get(model.provider) || [];
      group.push(model);
      providerGroups.set(model.provider, group);
    }
    
    return Array.from(providerGroups.entries())
      .map(([provider, providerModels]) => ({
        provider,
        models: providerModels,
        providerDef: PROVIDER_MAP[provider],
      }))
      .sort((a, b) => {
        const aName = a.providerDef?.name || a.provider;
        const bName = b.providerDef?.name || b.provider;
        return aName.localeCompare(bName);
      });
  }, [models]);
  
  // Fuzzy search items
  const fuzzyItems = useMemo(
    () =>
      models.map((model) => ({
        value: model.modelId,
        searchText: `${PROVIDER_MAP[model.provider]?.name || model.provider} ${model.displayName} ${model.modelId}`,
      })),
    [models]
  );
  
  const fuzzyFilter = useFuzzyFilter(fuzzyItems);
  
  const selectedModelInfo = models.find(
    m => m.provider === selectedProvider && m.modelId === selectedModelId
  );
  const SelectedProviderIcon = selectedProvider ? PROVIDER_MAP[selectedProvider]?.icon : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={isLoading}
          className={cn(
            'nodrag justify-between bg-secondary border border-border hover:bg-secondary/80 hover:border-border/80 text-secondary-foreground',
            compact ? 'h-7 text-xs px-2 w-full' : 'h-8 text-sm px-2 w-full'
          )}
        >
          {selectedModelInfo ? (
            <span className="flex items-center gap-1.5 min-w-0">
              {SelectedProviderIcon && (
                <span className="shrink-0 flex items-center opacity-70">
                  <SelectedProviderIcon size={compact ? 12 : 14} />
                </span>
              )}
              <span className="truncate">{selectedModelInfo.modelId}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select model...</span>
          )}
          <ChevronDownIcon size={compact ? 12 : 14} className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 border-border bg-popover"
        align="start"
      >
        <Command className="bg-transparent" filter={fuzzyFilter}>
          <CommandInput placeholder="Search models..." className="border-border" />
          <CommandList className="max-h-64">
            <CommandEmpty>No models found.</CommandEmpty>
            {groupedModels.map((group) => (
              <Fragment key={group.provider}>
                <CommandGroup heading={group.providerDef?.name || group.provider}>
                  {group.models.map((model) => {
                    const modelKey = `${model.provider}:${model.modelId}`;
                    const ProviderIcon = PROVIDER_MAP[model.provider]?.icon;
                    
                    return (
                      <CommandItem
                        key={modelKey}
                        value={model.modelId}
                        onSelect={() => {
                          onChange(modelKey);
                          setOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          {ProviderIcon && (
                            <span className="shrink-0 flex items-center opacity-70">
                              <ProviderIcon size={14} />
                            </span>
                          )}
                          <span className="truncate">{model.modelId}</span>
                        </span>
                        {modelKey === selectedModel && (
                          <CheckIcon size={14} className="shrink-0" />
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
