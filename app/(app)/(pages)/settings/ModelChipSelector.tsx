"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
import { PROVIDER_MAP } from "./providers/ProviderRegistry";
import { useFuzzyFilter } from "@/lib/hooks/use-fuzzy-filter";

interface Model {
  provider: string;
  modelId: string;
  displayName: string;
}

interface ModelChipSelectorProps {
  selectedModels: Model[];
  availableModels: Model[];
  onAdd: (provider: string, modelId: string) => void;
  onRemove: (provider: string, modelId: string) => void;
  loading?: boolean;
}

const SHOW_MORE_THRESHOLD = 6;
const COLLAPSED_HEIGHT = 115;

function getModelKey(model: Model): string {
  return `${model.provider}:${model.modelId}`;
}

function SkeletonChip() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-sm shadow-sm h-8">
      <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
      <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
      <div className="h-3 w-3 rounded bg-muted animate-pulse" />
    </div>
  );
}

export default function ModelChipSelector({
  selectedModels,
  availableModels,
  onAdd,
  onRemove,
  loading = false,
}: ModelChipSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const selectedKeys = useMemo(
    () => new Set(selectedModels.map(getModelKey)),
    [selectedModels],
  );

  const unselectedModels = useMemo(
    () => availableModels.filter((m) => !selectedKeys.has(getModelKey(m))),
    [availableModels, selectedKeys],
  );

  const groupedUnselected = useMemo(() => {
    const groups = new Map<string, Model[]>();
    for (const model of unselectedModels) {
      if (!groups.has(model.provider)) {
        groups.set(model.provider, []);
      }
      groups.get(model.provider)!.push(model);
    }
    return Array.from(groups.entries())
      .map(([provider, models]) => ({
        provider,
        models,
        providerDef: PROVIDER_MAP[provider],
      }))
      .sort((a, b) =>
        (a.providerDef?.name || a.provider).localeCompare(
          b.providerDef?.name || b.provider
        )
      );
  }, [unselectedModels]);

  const fuzzyItems = useMemo(
    () =>
      unselectedModels.map((model) => ({
        value: `${model.provider}:${model.modelId}:${model.displayName}`,
        searchText: `${PROVIDER_MAP[model.provider]?.name || model.provider} ${model.displayName} ${model.modelId}`,
      })),
    [unselectedModels],
  );

  const fuzzyFilter = useFuzzyFilter(fuzzyItems);

  const canCollapse = selectedModels.length > SHOW_MORE_THRESHOLD;
  const isCollapsed = canCollapse && !showAll;

  if (!loading && selectedModels.length === 0 && unselectedModels.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No models available. Add providers first.
      </div>
    );
  }

  return (
    <div className="relative">
      <motion.div
        className="flex items-start gap-2 flex-wrap overflow-hidden"
        animate={{ maxHeight: isCollapsed ? COLLAPSED_HEIGHT : 1000 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground border border-dashed border-border/60 hover:border-border hover:bg-muted/50"
              disabled={loading}
            >
              <Plus size={14} />
              Add
            </Button>
          </PopoverTrigger>
          {!loading && (
            <PopoverContent
              className="w-72 border border-border bg-popover shadow-lg rounded-xl p-0"
              align="start"
            >
              <Command className="rounded-xl" filter={fuzzyFilter}>
                <CommandInput placeholder="Search models..." />
                <CommandList className="max-h-64">
                  <CommandEmpty>No models available.</CommandEmpty>
                  {groupedUnselected.map((group) => (
                    <CommandGroup
                      key={group.provider}
                      heading={group.providerDef?.name || group.provider}
                    >
                      {group.models.map((model) => {
                        const ProviderIcon = PROVIDER_MAP[model.provider]?.icon;
                        return (
                          <CommandItem
                            key={getModelKey(model)}
                            value={`${model.provider}:${model.modelId}:${model.displayName}`}
                            onSelect={() => {
                              onAdd(model.provider, model.modelId);
                              setOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="flex items-center gap-2 flex-1 min-w-0">
                              {ProviderIcon && (
                                <span className="shrink-0 flex items-center opacity-70">
                                  <ProviderIcon size={16} />
                                </span>
                              )}
                              <span className="truncate">{model.displayName}</span>
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          )}
        </Popover>

        {loading ? (
          <>
            <SkeletonChip />
            <SkeletonChip />
            <SkeletonChip />
          </>
        ) : (
          <AnimatePresence mode="popLayout">
            {selectedModels.map((model) => {
              const ProviderIcon = PROVIDER_MAP[model.provider]?.icon;

              return (
                <motion.div
                  key={getModelKey(model)}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="group inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-sm shadow-sm hover:border-border transition-colors">
                    {ProviderIcon && (
                      <span className="shrink-0 flex items-center opacity-70">
                        <ProviderIcon size={14} />
                      </span>
                    )}
                    <span className="truncate max-w-[180px] text-foreground/90">
                      {model.displayName}
                    </span>
                    <button
                      onClick={() => onRemove(model.provider, model.modelId)}
                      className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 hover:bg-muted transition-all"
                      aria-label={`Remove ${model.displayName}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </motion.div>

      <AnimatePresence>
        {!loading && isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-0 left-0 right-0 h-16 z-10 pointer-events-none [mask-image:linear-gradient(to_top,black,transparent)] [-webkit-mask-image:linear-gradient(to_top,black,transparent)]"
          >
            <div className="absolute inset-0 bg-sidebar" />
            <div className="absolute inset-0 bg-background dark:bg-card/30" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!loading && canCollapse && (
          <motion.div
            key={showAll ? "show-less" : "show-more"}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className={`flex justify-center ${isCollapsed ? "absolute inset-x-0 bottom-0 h-12 items-end z-20" : "mt-3"}`}
          >
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAll ? "Show less" : "Show more"}
              <motion.span
                animate={{ rotate: showAll ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown size={12} />
              </motion.span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
