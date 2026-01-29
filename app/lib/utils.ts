import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const RECENT_MODELS_KEY = "recentModels";
const MAX_RECENT_MODELS = 5;

export function addRecentModel(modelKey: string): void {
  if (typeof window === "undefined" || !modelKey) return;

  const stored = localStorage.getItem(RECENT_MODELS_KEY);
  const recent: string[] = stored ? JSON.parse(stored) : [];
  const updated = [modelKey, ...recent.filter((key) => key !== modelKey)].slice(0, MAX_RECENT_MODELS);

  localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(updated));
}

export function getRecentModels(): string[] {
  if (typeof window === "undefined") return [];

  const stored = localStorage.getItem(RECENT_MODELS_KEY);
  return stored ? JSON.parse(stored) : [];
}
