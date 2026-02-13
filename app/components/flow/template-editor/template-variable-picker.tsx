'use client';

import { useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { filterTemplateVariables, formatPreviewDisplay } from './template-variable-utils';
import type { TemplateVariableOption } from './types';

interface TemplateVariablePickerProps {
  options: TemplateVariableOption[];
  onSelect: (option: TemplateVariableOption) => void;
}

export function TemplateVariablePicker({ options, onSelect }: TemplateVariablePickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => filterTemplateVariables(options, query),
    [options, query]
  );

  return (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandInput
        placeholder="Search variables..."
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList className="max-h-60">
        {filtered.length === 0 ? (
          <CommandEmpty>No variables found.</CommandEmpty>
        ) : (
          filtered.map(option => (
            <CommandItem
              key={option.expr}
              value={option.expr}
              onSelect={() => onSelect(option)}
              className="mx-1 my-0.5"
            >
              <div className="flex w-full flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{option.expr}</span>
                  {option.group && (
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {option.group}
                    </span>
                  )}
                </div>
                <span className="preview-clamp text-[11px] text-muted-foreground whitespace-pre-wrap">
                  {formatPreviewDisplay(option.preview)}
                </span>
              </div>
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}
