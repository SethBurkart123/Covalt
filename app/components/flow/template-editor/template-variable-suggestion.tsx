'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatPreviewDisplay } from './template-variable-utils';
import type { TemplateVariableOption } from './types';

export interface TemplateVariableSuggestionListProps {
  items: TemplateVariableOption[];
  command: (item: TemplateVariableOption) => void;
}

export interface TemplateVariableSuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const TemplateVariableSuggestionList = forwardRef<
  TemplateVariableSuggestionListHandle,
  TemplateVariableSuggestionListProps
>(function TemplateVariableSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((index) => (index + items.length - 1) % items.length);
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % items.length);
        return true;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="min-w-[220px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No matches
      </div>
    );
  }

  return (
    <div className="min-w-[260px] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
      {items.map((item, index) => (
        <button
          key={`${item.expr}-${index}`}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(index)}
          className={cn(
            'flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            index === selectedIndex
              ? 'bg-primary/10 text-primary'
              : 'text-foreground hover:bg-muted'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{item.expr}</span>
            {item.group && (
              <span className="text-[10px] uppercase text-muted-foreground">{item.group}</span>
            )}
          </div>
          <span className="preview-clamp text-[11px] text-muted-foreground whitespace-pre-wrap">
            {formatPreviewDisplay(item.preview)}
          </span>
        </button>
      ))}
    </div>
  );
});
