import type { ReactNode } from "react";

export type Status = "success" | "error" | "warning" | "info";

export function isStatus(value: unknown): value is Status {
  return value === "success" || value === "error" || value === "warning" || value === "info";
}

export function spacing(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${value * 0.25}rem`;
}

export function statusToTextClass(status?: Status): string {
  switch (status) {
    case "success":
      return "text-emerald-500";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-amber-500";
    case "info":
      return "text-sky-500";
    default:
      return "text-muted-foreground";
  }
}

export function statusToDotClass(status?: Status): string {
  switch (status) {
    case "success":
      return "bg-emerald-500";
    case "error":
      return "bg-destructive";
    case "warning":
      return "bg-amber-500";
    case "info":
      return "bg-sky-500";
    default:
      return "bg-muted-foreground";
  }
}

export function statusToPillClass(status?: Status): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "warning":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    case "info":
      return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function variantToPillClass(variant?: string): string {
  switch (variant) {
    case "destructive":
    case "error":
    case "danger":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "success":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "warning":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    case "info":
    case "blue":
    case "cyan":
      return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20";
    case "outline":
      return "bg-transparent text-foreground border-border";
    default:
      return "bg-muted text-foreground border-border";
  }
}

export function colorToHex(color?: string): string {
  switch (color) {
    case "success":
    case "green":
      return "#10b981";
    case "error":
    case "danger":
    case "red":
      return "#ef4444";
    case "warning":
    case "yellow":
      return "#f59e0b";
    case "muted":
    case "gray":
      return "#9ca3af";
    case "info":
    case "blue":
      return "#3b82f6";
    case "cyan":
      return "#06b6d4";
    default:
      return color ?? "#3b82f6";
  }
}

export function colorToTextClass(color?: string): string | undefined {
  switch (color) {
    case "success":
    case "green":
      return "text-emerald-500";
    case "error":
    case "danger":
    case "red":
      return "text-destructive";
    case "warning":
    case "yellow":
      return "text-amber-500";
    case "muted":
    case "gray":
      return "text-muted-foreground";
    case "info":
    case "blue":
      return "text-sky-500";
    case "cyan":
      return "text-cyan-500";
    default:
      return undefined;
  }
}

export function renderValue(value: unknown): ReactNode {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
