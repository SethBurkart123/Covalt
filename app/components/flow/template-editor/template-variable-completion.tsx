'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatPreviewDisplay } from './template-variable-utils';
import type { TemplateVariableCompletion } from './types';

export interface TemplateVariableCompletionListProps {
  items: TemplateVariableCompletion[];
  command: (item: TemplateVariableCompletion) => void;
}

export interface TemplateVariableCompletionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const TemplateVariableCompletionList = forwardRef<
  TemplateVariableCompletionListHandle,
  TemplateVariableCompletionListProps
>(function TemplateVariableCompletionList({ items, command }, ref) {
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

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  if (items.length === 0) {
    return null;
  }

  const activeItem = items[selectedIndex] ?? items[0];

  return (
    <div className="flex min-w-[420px] max-w-[520px] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
      <div className="w-56 max-h-64 overflow-y-auto p-1">
        {items.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectItem(index)}
            className={cn(
              'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              index === selectedIndex
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-muted'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium font-mono">{item.label}</span>
              <span className="text-[10px] uppercase text-muted-foreground">field</span>
            </div>
          </button>
        ))}
      </div>
      <div className="w-64 border-l border-border/60 bg-muted/40 px-3 py-2 max-h-64 overflow-y-auto">
        <p className="text-xs font-semibold text-foreground truncate font-mono">
          {activeItem?.label ?? ''}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono">
          {formatPreviewDisplay(activeItem?.preview)}
        </p>
      </div>
    </div>
  );
});
