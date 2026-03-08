import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const RECENT_MODELS_KEY = "recentModels";
const MAX_RECENT_MODELS = 5;

function parseRecentModels(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentModel(modelKey: string): void {
  if (typeof window === "undefined" || !modelKey) return;

  const stored = localStorage.getItem(RECENT_MODELS_KEY);
  const recent = parseRecentModels(stored);
  const updated = [modelKey, ...recent.filter((key) => key !== modelKey)].slice(0, MAX_RECENT_MODELS);

  localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(updated));
}

export function getRecentModels(): string[] {
  if (typeof window === "undefined") return [];

  return parseRecentModels(localStorage.getItem(RECENT_MODELS_KEY));
}
