"use client";

import type { Editor, Range } from "@tiptap/core";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SlashCommandItem {
  title: string;
  subtitle: string;
  searchTerms?: string[];
  icon?: ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
}

interface SlashCommandSuggestionListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandSuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandSuggestionList = forwardRef<
  SlashCommandSuggestionListHandle,
  SlashCommandSuggestionListProps
>(function SlashCommandSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevItemsRef = useRef(items);
  if (items !== prevItemsRef.current) {
    prevItemsRef.current = items;
    setSelectedIndex(0);
  }

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (index + items.length - 1) % items.length);
        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % items.length);
        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="min-w-[240px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No matches
      </div>
    );
  }

  return (
    <div className="min-w-[280px] max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
      {items.map((item, index) => (
        <button
          key={`${item.title}-${index}`}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(index)}
          className={cn(
            "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
            index === selectedIndex
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted"
          )}
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {item.icon ?? <span className="text-xs font-medium">/</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{item.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  );
});
