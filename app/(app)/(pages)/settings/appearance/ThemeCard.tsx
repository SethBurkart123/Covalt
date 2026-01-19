"use client";

import { Check, Trash2 } from "lucide-react";
import type { ThemeStyleProps } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ThemeCardProps {
  id: string;
  name: string;
  lightStyles: ThemeStyleProps;
  darkStyles: ThemeStyleProps;
  isSelected: boolean;
  isCustom: boolean;
  previewMode: "light" | "dark";
  onSelect: () => void;
  onDelete?: () => void;
}

export function ThemeCard({
  name,
  lightStyles,
  darkStyles,
  isSelected,
  isCustom,
  previewMode,
  onSelect,
  onDelete,
}: ThemeCardProps) {
  const styles = previewMode === "light" ? lightStyles : darkStyles;

  return (
    <div className="relative group">
      <button
        onClick={onSelect}
        className={cn(
          "w-full rounded-lg border-2 overflow-hidden transition-all",
          isSelected
            ? "border-primary ring-2 ring-primary/20"
            : "border-border hover:border-muted-foreground/50"
        )}
      >
        <div
          className="aspect-[4/3] p-3"
          style={{ backgroundColor: styles.background || "#ffffff" }}
        >
          <div
            className="rounded-md overflow-hidden h-full"
            style={{
              backgroundColor: styles.card || "#ffffff",
              border: `1px solid ${styles.border || "#e5e5e5"}`,
            }}
          >
            <div
              className="h-5 flex items-center gap-1 px-2"
              style={{ backgroundColor: styles.muted || "#f5f5f5" }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: styles.destructive || "#ff5f5f" }}
              />
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: styles.accent || "#ffbd2e" }}
              />
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: styles["chart-1"] || "#28c840" }}
              />
            </div>

            <div className="p-2 space-y-1.5">
              <div
                className="h-1.5 rounded-full w-3/4"
                style={{ backgroundColor: styles["muted-foreground"] || "#888888", opacity: 0.5 }}
              />
              <div
                className="h-2 rounded-full w-full"
                style={{ backgroundColor: styles.primary || "#3b82f6" }}
              />
              <div
                className="h-1.5 rounded-full w-2/3"
                style={{ backgroundColor: styles["muted-foreground"] || "#888888", opacity: 0.5 }}
              />
              <div
                className="h-1.5 rounded-full w-1/2"
                style={{ backgroundColor: styles["muted-foreground"] || "#888888", opacity: 0.5 }}
              />
            </div>
          </div>
        </div>

        <div
          className="px-3 py-2 text-sm font-medium text-left flex items-center justify-between"
          style={{
            backgroundColor: styles.card || "#ffffff",
            color: styles.foreground || "#333333",
            borderTop: `1px solid ${styles.border || "#e5e5e5"}`,
          }}
        >
          <span className="truncate">{name}</span>
          {isSelected && (
            <Check className="w-4 h-4 shrink-0" style={{ color: styles.primary || "#3b82f6" }} />
          )}
        </div>
      </button>

      {isCustom && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
          title="Delete theme"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
