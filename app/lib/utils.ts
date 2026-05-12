import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { setRecentModels as saveRecentModels } from "@/python/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MAX_RECENT_MODELS = 5;

let cachedRecentModels: readonly string[] = [];

export function setRecentModelsCache(models: readonly string[]): void {
  cachedRecentModels = models;
}

export function addRecentModel(modelKey: string): void {
  if (!modelKey) return;

  cachedRecentModels = [modelKey, ...cachedRecentModels.filter((key) => key !== modelKey)].slice(0, MAX_RECENT_MODELS);
  saveRecentModels({ body: { modelKeys: cachedRecentModels } }).catch(() => {});
}

export function getRecentModels(): readonly string[] {
  return cachedRecentModels;
}

