
import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { ROOT_CONTAINER } from "./shared";

export function RootDropZone({ children }: { children: ReactNode }) {
  const droppable = useDroppable({
    id: "editor-root",
    data: { type: "editor-root" },
  });
  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(droppable.isOver && "ring-1 ring-primary/30 rounded-md")}
    >
      {children}
    </div>
  );
}

export function RootAppendZone({ active }: { active: boolean }) {
  const droppable = useDroppable({
    id: ROOT_CONTAINER,
    data: { type: "root-zone" },
  });
  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        "h-2 rounded-sm transition-colors",
        active && "my-1 border border-dashed border-border/70",
        active && droppable.isOver && "border-primary/60 bg-primary/10",
      )}
    />
  );
}

export function DragPreviewRow({
  label,
  folder,
}: {
  label: string;
  folder?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 h-7 bg-popover border rounded-md shadow-md text-xs font-medium",
        folder ? "border-primary/40" : "border-border",
      )}
    >
      {label}
    </div>
  );
}
