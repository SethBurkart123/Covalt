"use client";

import {
  getChatAgentConfig,
  getModelSelectionSettings as getModelSelectionSettingsApi,
  getModelSelectionState as getModelSelectionStateApi,
  saveModelSelectionSettings as saveModelSelectionSettingsApi,
  setModelSelectionState as setModelSelectionStateApi,
  updateChatSelectionState,
  type AgentInfo,
} from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";

export interface ModelSelectionState {
  modelKey: string;
  modelOptions: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export type ModelSelectionMode = "last_used" | "fixed";

export interface ModelSelectionSettings {
  mode: ModelSelectionMode;
  fixedSelection: ModelSelectionState;
}

interface ChatSelectionResponse {
  provider?: string;
  modelId?: string;
  agentId?: string | null;
  modelOptions?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}

export const EMPTY_SELECTION: ModelSelectionState = {
  modelKey: "",
  modelOptions: {},
  variables: {},
};

export const DEFAULT_SELECTION_SETTINGS: ModelSelectionSettings = {
  mode: "last_used",
  fixedSelection: EMPTY_SELECTION,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeSelectionState(
  value: Partial<ModelSelectionState> | null | undefined,
): ModelSelectionState {
  return {
    modelKey: typeof value?.modelKey === "string" ? value.modelKey : "",
    modelOptions: asRecord(value?.modelOptions),
    variables: asRecord(value?.variables),
  };
}

export function normalizeSelectionSettings(
  value:
    | { mode?: unknown; fixedSelection?: Partial<ModelSelectionState> | null }
    | null
    | undefined,
): ModelSelectionSettings {
  return {
    mode: value?.mode === "fixed" ? "fixed" : "last_used",
    fixedSelection: normalizeSelectionState(value?.fixedSelection),
  };
}

export function getModelKey(model: ModelInfo): string {
  return `${model.provider}:${model.modelId}`;
}

export function selectionFromChatConfig(
  config: ChatSelectionResponse | null | undefined,
): ModelSelectionState {
  if (!config) return EMPTY_SELECTION;

  const agentId = typeof config.agentId === "string" ? config.agentId : "";
  const provider = typeof config.provider === "string" ? config.provider : "";
  const modelId = typeof config.modelId === "string" ? config.modelId : "";
  const modelKey = agentId
    ? `agent:${agentId}`
    : provider && modelId
      ? `${provider}:${modelId}`
      : "";

  return normalizeSelectionState({
    modelKey,
    modelOptions: config.modelOptions,
    variables: config.variables,
  });
}

export function defaultModelKey(models: readonly ModelInfo[]): string {
  const model = models.find((item) => item.isDefault) || models[0];
  return model ? getModelKey(model) : "";
}

export function isSelectionAvailable(
  modelKey: string,
  models: readonly ModelInfo[],
  agents: readonly AgentInfo[],
): boolean {
  if (!modelKey) return false;
  if (modelKey.startsWith("agent:")) {
    const agentId = modelKey.slice("agent:".length);
    return agents.some((agent) => agent.id === agentId);
  }
  return models.some((model) => getModelKey(model) === modelKey);
}

export async function fetchGlobalModelSelection(): Promise<ModelSelectionState> {
  const state = await getModelSelectionStateApi();
  return normalizeSelectionState(state);
}

export async function saveGlobalModelSelection(
  state: ModelSelectionState,
): Promise<void> {
  await setModelSelectionStateApi({
    body: normalizeSelectionState(state),
  });
}

export async function fetchModelSelectionSettings(): Promise<ModelSelectionSettings> {
  const settings = await getModelSelectionSettingsApi();
  return normalizeSelectionSettings(settings);
}

export async function saveModelSelectionSettings(
  settings: ModelSelectionSettings,
): Promise<void> {
  await saveModelSelectionSettingsApi({
    body: normalizeSelectionSettings(settings),
  });
}

export async function fetchChatModelSelection(
  chatId: string,
): Promise<ModelSelectionState> {
  const config = await getChatAgentConfig({
    body: { id: chatId },
  });
  return selectionFromChatConfig(config);
}

export async function saveChatModelSelection(
  chatId: string,
  state: ModelSelectionState,
): Promise<void> {
  await updateChatSelectionState({
    body: {
      chatId,
      ...normalizeSelectionState(state),
    },
  });
}
