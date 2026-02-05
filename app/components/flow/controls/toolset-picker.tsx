'use client';

import { useState, useCallback, useEffect } from 'react';
import { CheckIcon, ChevronDownIcon, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listToolsets } from '@/python/api';
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

interface ToolsetPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

interface ToolsetOption {
  id: string;
  name: string;
  toolCount: number;
}

export function ToolsetPicker({ value, onChange, compact }: ToolsetPickerProps) {
  const [open, setOpen] = useState(false);
  const [toolsets, setToolsets] = useState<ToolsetOption[]>([]);

  useEffect(() => {
    listToolsets({ body: { userMcp: false } })
      .then((res) => {
        setToolsets(
          res.toolsets
            .filter((t) => t.enabled)
            .map((t) => ({ id: t.id, name: t.name, toolCount: t.toolCount ?? 0 }))
        );
      })
      .catch(console.error);
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  const selected = toolsets.find((t) => t.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'nodrag justify-between bg-secondary border border-border hover:bg-secondary/80 hover:border-border/80 text-secondary-foreground',
            compact ? 'h-7 text-xs px-2 w-full' : 'h-8 text-sm px-2 w-full',
          )}
        >
          {selected ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <Package className="size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select toolset...</span>
          )}
          <ChevronDownIcon size={compact ? 12 : 14} className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 border-border bg-popover" align="start">
        <Command className="bg-transparent">
          <CommandInput placeholder="Search toolsets..." className="border-border" />
          <CommandList className="max-h-64">
            {toolsets.length === 0 ? (
              <CommandEmpty>No toolsets installed.</CommandEmpty>
            ) : (
              <CommandEmpty>No matching toolsets.</CommandEmpty>
            )}
            <CommandGroup>
              {toolsets.map((t) => (
                <CommandItem
                  key={t.id}
                  value={t.id}
                  onSelect={() => handleSelect(t.id)}
                  className="cursor-pointer"
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <Package className="size-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{t.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {t.toolCount} tools
                    </span>
                  </span>
                  {t.id === value && <CheckIcon size={14} className="shrink-0 ml-2" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
