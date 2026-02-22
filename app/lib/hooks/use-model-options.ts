"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ModelInfo,
  OptionDefinition,
  OptionSchema,
} from "@/lib/types/chat";

interface PersistedOptions {
  version: number;
  values: Record<string, unknown>;
}

interface StorageContext {
  provider: string;
  modelId: string;
}

const STORAGE_VERSION = 1;
const EMPTY_SCHEMA: OptionSchema = { main: [], advanced: [] };

function getStorageKey(provider: string, modelId: string): string {
  return `modelOptions:${provider}:${modelId}`;
}

function getAllDefinitions(schema: OptionSchema): OptionDefinition[] {
  return [...schema.main, ...schema.advanced];
}

export function getDefaults(schema: OptionSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const definition of getAllDefinitions(schema)) {
    defaults[definition.key] = definition.default;
  }
  return defaults;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidValue(value: unknown, definition: OptionDefinition): boolean {
  if (definition.type === "boolean") {
    return typeof value === "boolean";
  }

  if (definition.type === "select") {
    const options = definition.options ?? [];
    return options.some((option) => option.value === value);
  }

  if (definition.type === "number" || definition.type === "slider") {
    if (!isFiniteNumber(value)) return false;
    if (definition.min !== undefined && value < definition.min) return false;
    if (definition.max !== undefined && value > definition.max) return false;
    return true;
  }

  return false;
}

export function isOptionVisible(
  definition: OptionDefinition,
  values: Record<string, unknown>,
): boolean {
  const condition = definition.showWhen;
  if (!condition) return true;

  const dependencyValue = values[condition.option];
  return condition.values.includes(dependencyValue);
}

function resolveStorageContext(selectedModel: string): StorageContext | null {
  if (!selectedModel || !selectedModel.includes(":")) return null;

  const [provider, modelId] = selectedModel.split(":", 2);
  if (!provider || !modelId || provider === "agent") return null;

  return { provider, modelId };
}

function loadPersistedOptions(
  storage: StorageContext,
  schema: OptionSchema,
): Record<string, unknown> {
  if (typeof window === "undefined") return getDefaults(schema);

  const storageKey = getStorageKey(storage.provider, storage.modelId);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return getDefaults(schema);

  try {
    const parsed = JSON.parse(raw) as PersistedOptions;
    if (!parsed || typeof parsed !== "object") return getDefaults(schema);
    if (parsed.version !== STORAGE_VERSION) return getDefaults(schema);

    const values =
      parsed.values && typeof parsed.values === "object" ? parsed.values : {};
    const nextValues: Record<string, unknown> = {};

    for (const definition of getAllDefinitions(schema)) {
      const candidate = (values as Record<string, unknown>)[definition.key];
      nextValues[definition.key] =
        candidate !== undefined && isValidValue(candidate, definition)
          ? candidate
          : definition.default;
    }

    return nextValues;
  } catch (error) {
    console.error("Failed to parse persisted model options:", error);
    return getDefaults(schema);
  }
}

function savePersistedOptions(
  storage: StorageContext,
  values: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;

  const payload: PersistedOptions = {
    version: STORAGE_VERSION,
    values,
  };

  localStorage.setItem(
    getStorageKey(storage.provider, storage.modelId),
    JSON.stringify(payload),
  );
}

export function useModelOptions(
  selectedModel: string,
  models: ModelInfo[],
): {
  schema: OptionSchema;
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  reset: () => void;
  getVisibleValues: () => Record<string, unknown>;
} {
  const storage = useMemo(
    () => resolveStorageContext(selectedModel),
    [selectedModel],
  );

  const schema = useMemo<OptionSchema>(() => {
    if (!storage) return EMPTY_SCHEMA;

    const model = models.find(
      (entry) =>
        entry.provider === storage.provider && entry.modelId === storage.modelId,
    );
    return model?.options ?? EMPTY_SCHEMA;
  }, [models, storage]);

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getDefaults(schema),
  );

  useEffect(() => {
    if (!storage) {
      setValues(getDefaults(schema));
      return;
    }

    setValues(loadPersistedOptions(storage, schema));
  }, [schema, storage]);

  const setValue = useCallback(
    (key: string, value: unknown) => {
      setValues((currentValues) => {
        const nextValues = { ...currentValues, [key]: value };
        if (storage) {
          savePersistedOptions(storage, nextValues);
        }
        return nextValues;
      });
    },
    [storage],
  );

  const reset = useCallback(() => {
    const defaults = getDefaults(schema);
    setValues(defaults);

    if (storage) {
      savePersistedOptions(storage, defaults);
    }
  }, [schema, storage]);

  const getVisibleValues = useCallback((): Record<string, unknown> => {
    const visibleValues: Record<string, unknown> = {};
    for (const definition of getAllDefinitions(schema)) {
      if (!isOptionVisible(definition, values)) continue;
      visibleValues[definition.key] = values[definition.key] ?? definition.default;
    }
    return visibleValues;
  }, [schema, values]);

  return {
    schema,
    values,
    setValue,
    reset,
    getVisibleValues,
  };
}
