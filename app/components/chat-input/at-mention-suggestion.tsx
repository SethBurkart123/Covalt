"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/utils";
import type { MentionItem } from "./at-mention-extension";

export interface MentionSuggestionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  query?: string;
}

export interface MentionSuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionSuggestionList = forwardRef<
  MentionSuggestionListHandle,
  MentionSuggestionListProps
>(function MentionSuggestionList({ items, command, query }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const normalizedQuery = (query ?? "").trim();
  const showSections = normalizedQuery.length === 0;
  const servers = showSections ? items.filter((item) => item.type === "mcp") : [];
  const tools = showSections ? items.filter((item) => item.type !== "mcp") : [];
  const orderedItems = showSections ? [...servers, ...tools] : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index: number) => {
    const item = orderedItems[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (orderedItems.length === 0) return false;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index + orderedItems.length - 1) % orderedItems.length
        );
        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % orderedItems.length);
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

  if (orderedItems.length === 0) {
    return (
      <div className="min-w-[220px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No matches
      </div>
    );
  }

  const renderItems = (list: MentionItem[], offset: number) =>
    list.map((item, index) => {
      const absoluteIndex = offset + index;
      return (
        <button
          key={`${item.type}-${item.id}-${absoluteIndex}`}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectItem(absoluteIndex)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            absoluteIndex === selectedIndex
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted"
          )}
        >
          <span className="truncate font-medium">@{item.label}</span>
          {item.serverLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.serverLabel}
            </span>
          )}
        </button>
      );
    });

  if (!showSections) {
    return (
      <div className="min-w-[240px] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
        {renderItems(orderedItems, 0)}
      </div>
    );
  }

  let offset = 0;
  const serverNodes = renderItems(servers, offset);
  offset += servers.length;
  const toolNodes = renderItems(tools, offset);

  return (
    <div className="min-w-[240px] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
      {servers.length > 0 && (
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Servers
          </div>
          {serverNodes}
        </>
      )}
      {servers.length > 0 && tools.length > 0 && (
        <div className="my-1 border-t border-border/60" />
      )}
      {tools.length > 0 && (
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Tools
          </div>
          {toolNodes}
        </>
      )}
    </div>
  );
});
