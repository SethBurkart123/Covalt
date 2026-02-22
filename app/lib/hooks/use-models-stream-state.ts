import type { ModelInfo } from "@/lib/types/chat";

export interface ProviderState {
  providerOrder: string[];
  providerModels: Map<string, ModelInfo[]>;
}

export function normalizeDefaultModel(models: ModelInfo[]): ModelInfo[] {
  if (models.length === 0) return models;

  return models.map((model, index) => {
    const isDefault = index === 0;
    if (model.isDefault === isDefault) return model;
    return { ...model, isDefault };
  });
}

export function buildProviderState(models: ModelInfo[]): ProviderState {
  const providerOrder: string[] = [];
  const providerModels = new Map<string, ModelInfo[]>();

  for (const model of models) {
    if (!providerModels.has(model.provider)) {
      providerOrder.push(model.provider);
      providerModels.set(model.provider, []);
    }
    providerModels.get(model.provider)!.push(model);
  }

  return { providerOrder, providerModels };
}

export function reorderProviderState(
  state: ProviderState,
  expectedProviders: string[],
): void {
  const orderedProviders: string[] = [];
  const seenProviders = new Set<string>();

  for (const provider of expectedProviders) {
    if (seenProviders.has(provider)) continue;
    seenProviders.add(provider);
    orderedProviders.push(provider);
  }

  for (const provider of state.providerOrder) {
    if (seenProviders.has(provider)) continue;
    seenProviders.add(provider);
    orderedProviders.push(provider);
  }

  state.providerOrder = orderedProviders;
}

export function removeProvider(state: ProviderState, provider: string): void {
  if (!state.providerModels.has(provider)) return;
  state.providerModels.delete(provider);
  state.providerOrder = state.providerOrder.filter((current) => current !== provider);
}

export function upsertProvider(
  state: ProviderState,
  provider: string,
  nextProviderModels: ModelInfo[],
): void {
  if (nextProviderModels.length === 0) {
    removeProvider(state, provider);
    return;
  }

  if (!state.providerOrder.includes(provider)) {
    state.providerOrder = [...state.providerOrder, provider];
  }

  state.providerModels.set(provider, nextProviderModels);
}

export function syncModelsFromProviderState(state: ProviderState): ModelInfo[] {
  const flattened: ModelInfo[] = [];

  for (const provider of state.providerOrder) {
    const models = state.providerModels.get(provider);
    if (models && models.length > 0) flattened.push(...models);
  }

  return normalizeDefaultModel(flattened);
}

export function pruneProviderState(
  state: ProviderState,
  expectedProviders: Set<string>,
  seenProviders: Set<string>,
): void {
  for (const provider of [...state.providerModels.keys()]) {
    if (!expectedProviders.has(provider) || !seenProviders.has(provider)) {
      removeProvider(state, provider);
    }
  }
}
