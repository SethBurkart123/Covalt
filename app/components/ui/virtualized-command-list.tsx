"use client";

import { useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CommandEmpty, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface VirtualizedCommandListProps<T> {
  items: T[];
  estimateSize: (index: number) => number;
  children: (item: T, index: number) => ReactNode;
  maxHeight?: number;
  overscan?: number;
  emptyMessage?: string;
  className?: string;
}

export function VirtualizedCommandList<T>({
  items,
  estimateSize,
  children,
  maxHeight = 320,
  overscan = 15,
  emptyMessage = "No results found.",
  className = "",
}: VirtualizedCommandListProps<T>) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize,
    overscan,
  });

  if (items.length === 0) {
    return (
      <CommandList>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
      </CommandList>
    );
  }

  return (
    <div
      ref={setScrollEl}
      className={cn("overflow-y-auto overflow-x-hidden", className)}
      style={{ maxHeight }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => (
          <div
            key={vItem.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vItem.size,
              transform: `translateY(${vItem.start}px)`,
            }}
          >
            {children(items[vItem.index], vItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
