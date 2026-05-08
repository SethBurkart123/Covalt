import type { VariableSpec } from "@nodes/_variables";

const STORAGE_VERSION = 1;

export interface PersistedVariableValues {
  version: number;
  values: Record<string, unknown>;
}

export function defaultForControl(spec: VariableSpec): unknown {
  switch (spec.control.kind) {
    case "boolean":
      return false;
    case "number":
    case "slider":
      return spec.control.min ?? 0;
    case "select":
    case "searchable":
      return spec.control.multi ? [] : undefined;
    default:
      return "";
  }
}

export function buildDefaults(specs: VariableSpec[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const spec of specs) {
    defaults[spec.id] = spec.default ?? defaultForControl(spec);
  }
  return defaults;
}

export function loadPersistedValues(
  storageKey: string | null,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  if (!storageKey || typeof window === "undefined") return { ...defaults };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as PersistedVariableValues;
    if (!parsed || parsed.version !== STORAGE_VERSION) return { ...defaults };
    return { ...defaults, ...parsed.values };
  } catch (error) {
    console.error("Failed to load persisted variables", error);
    return { ...defaults };
  }
}

export function persistVariableValues(
  storageKey: string | null,
  values: Record<string, unknown>,
): void {
  if (!storageKey || typeof window === "undefined") return;
  const payload: PersistedVariableValues = { version: STORAGE_VERSION, values };
  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist variables", error);
  }
}
