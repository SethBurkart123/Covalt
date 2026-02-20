'use client';

import { useCallback, useMemo, useState } from 'react';
import { CheckIcon, ChevronDownIcon, Crosshair, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFlowState, useNodePicker, type NodeRefParameter } from '@/lib/flow';
import { getNodeName } from '../flow-data-utils';
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
import type { ControlProps } from './';

interface NodePickerProps extends Omit<ControlProps, 'onChange' | 'value'> {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}

interface NodeOption {
  id: string;
  name: string;
}

const NONE_OPTION = '__none__';

export function NodePicker({ param, value, onChange, compact, nodeId }: NodePickerProps) {
  const [open, setOpen] = useState(false);
  const { nodes } = useFlowState();
  const picker = useNodePicker();
  const nodeParam = param as NodeRefParameter;

  const options = useMemo<NodeOption[]>(() => {
    const allowedTypes = nodeParam.nodeTypes?.length ? new Set(nodeParam.nodeTypes) : null;
    return nodes
      .filter((node) => {
        if (!node?.id || !node.type) return false;
        if (!nodeParam.allowSelf && nodeId && node.id === nodeId) return false;
        if (allowedTypes && !allowedTypes.has(node.type)) return false;
        return true;
      })
      .map((node) => ({
        id: node.id,
        name: getNodeName(node),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [nodeId, nodeParam.allowSelf, nodeParam.nodeTypes, nodes]);

  const valueId = typeof value === 'string' ? value : null;
  const selected = options.find((option) => option.id === valueId) ?? null;
  const placeholder = nodeParam.placeholder ?? 'Select a node...';
  const selectionLabel = selected?.name ?? (valueId ? `Missing node (${valueId})` : placeholder);

  const isPicking =
    picker.active &&
    picker.originNodeId === nodeId &&
    picker.paramId === param.id;

  const handleSelect = useCallback(
    (nextId: string) => {
      if (nextId === NONE_OPTION) {
        onChange(null);
      } else {
        onChange(nextId);
      }
      if (picker.active) {
        picker.cancelPick();
      }
      setOpen(false);
    },
    [onChange, picker]
  );

  const handlePickToggle = useCallback(() => {
    if (!nodeId) return;
    if (isPicking) {
      picker.cancelPick();
      return;
    }
    const allowedNodeTypes = nodeParam.nodeTypes ? Array.from(nodeParam.nodeTypes) : null;
    picker.startPick({
      originNodeId: nodeId,
      paramId: param.id,
      allowedNodeTypes,
      allowSelf: nodeParam.allowSelf ?? false,
    });
    setOpen(false);
  }, [isPicking, nodeId, nodeParam.allowSelf, nodeParam.nodeTypes, param.id, picker]);

  const pickDisabled = !nodeId || options.length === 0;

  return (
    <div className="flex items-center gap-2 w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'nodrag justify-between bg-secondary border border-border hover:bg-secondary/80 hover:border-border/80 text-secondary-foreground flex-1 min-w-0',
              compact ? 'h-7 text-xs px-2' : 'h-8 text-sm px-2'
            )}
          >
            {selected ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <Bot className="size-3 text-muted-foreground shrink-0" />
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground truncate">{selectionLabel}</span>
            )}
            <ChevronDownIcon size={compact ? 12 : 14} className="shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0 border-border bg-popover" align="start">
          <Command className="bg-transparent">
            <CommandInput placeholder="Search nodes..." className="border-border" />
            <CommandList className="max-h-64">
              {options.length === 0 ? (
                <CommandEmpty>No nodes available.</CommandEmpty>
              ) : (
                <CommandEmpty>No matching nodes.</CommandEmpty>
              )}
              <CommandGroup>
                <CommandItem
                  value={NONE_OPTION}
                  keywords={['none', 'default']}
                  onSelect={() => handleSelect(NONE_OPTION)}
                  className="cursor-pointer"
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0 text-muted-foreground">
                    None (use graph default)
                  </span>
                  {!valueId && <CheckIcon size={14} className="shrink-0 ml-2" />}
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    keywords={[option.name, option.id]}
                    onSelect={() => handleSelect(option.id)}
                    className="cursor-pointer"
                  >
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <Bot className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{option.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{option.id}</span>
                    </span>
                    {option.id === valueId && <CheckIcon size={14} className="shrink-0 ml-2" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant={isPicking ? 'secondary' : 'ghost'}
        size={compact ? 'icon' : 'sm'}
        className={cn(
          'nodrag border border-border/60',
          isPicking && 'bg-primary/10 text-primary border-primary/40',
          pickDisabled && 'opacity-50 pointer-events-none'
        )}
        title={pickDisabled ? 'No matching nodes to pick' : isPicking ? 'Cancel picker' : 'Pick from graph'}
        onClick={handlePickToggle}
        disabled={pickDisabled}
      >
        <Crosshair className={compact ? 'size-3.5' : 'size-4'} />
      </Button>
    </div>
  );
}
