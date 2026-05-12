import { useState, useEffect, useCallback, useRef } from "react";
import {
  streamAvailableModels,
  getSelectedModel as fetchSelectedModel,
  setSelectedModel as saveSelectedModel,
  getRecentModels as fetchRecentModels,
  toAsyncIterable,
} from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";
import { setRecentModelsCache } from "@/lib/utils";
import { subscribeBackendBaseUrl } from "@/lib/services/backend-url";
import {
  buildProviderState,
  normalizeDefaultModel,
  pruneProviderState,
  removeProvider,
  reorderProviderState,
  syncModelsFromProviderState,
  upsertProvider,
} from "@/lib/hooks/use-models-stream-state";

const CACHE_KEY = "modelsCache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ModelsCache {
  models: readonly ModelInfo[];
  connectedProviders: readonly string[];
  timestamp: number;
}

interface ModelsStreamEvent {
  event: "ModelsStarted" | "ModelsBatch" | "ModelsFailed" | "ModelsCompleted" | string;
  provider?: string;
  models?: ModelInfo[];
  connectedProviders?: string[];
  expectedProviders?: string[];
}

function getCachedModels(): { models: readonly ModelInfo[]; connectedProviders: readonly string[] } | null {
  if (typeof window === "undefined") return null;

  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  try {
    const { models, connectedProviders, timestamp }: ModelsCache = JSON.parse(cached);
    return Date.now() - timestamp > CACHE_TTL ? null : { models: normalizeDefaultModel(models), connectedProviders };
  } catch {
    return null;
  }
}

function setCachedModels(models: readonly ModelInfo[], connectedProviders: readonly string[]): void {
  if (typeof window === "undefined") return;

  const cache: ModelsCache = {
    models: normalizeDefaultModel(models),
    connectedProviders,
    timestamp: Date.now(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function useModels() {
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [connectedProviders, setConnectedProviders] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeChannelRef = useRef<AbortController | null>(null);
  const activeLoadIdRef = useRef(0);
  const modelsRef = useRef<readonly ModelInfo[]>([]);
  const connectedProvidersRef = useRef<readonly string[]>([]);
  const savedModelRef = useRef<string>("");
  const recentModelsRef = useRef<readonly string[]>([]);

  modelsRef.current = models;
  connectedProvidersRef.current = connectedProviders;

  const selectModel = useCallback((nextModels: readonly ModelInfo[]) => {
    if (nextModels.length === 0) {
      setSelectedModel("");
      return;
    }

    const modelKeys = new Set(nextModels.map((m) => `${m.provider}:${m.modelId}`));
    const isAvailable = (key: string) => key.startsWith("agent:") || modelKeys.has(key);

    if (savedModelRef.current && isAvailable(savedModelRef.current)) {
      setSelectedModel(savedModelRef.current);
      return;
    }

    for (const recent of recentModelsRef.current) {
      if (isAvailable(recent)) {
        setSelectedModel(recent);
        savedModelRef.current = recent;
        saveSelectedModel({ body: { modelKey: recent } }).catch(() => {});
        return;
      }
    }

    const defaultModel = nextModels.find((m) => m.isDefault) || nextModels[0];
    const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
    setSelectedModel(modelKey);
    savedModelRef.current = modelKey;
    saveSelectedModel({ body: { modelKey } }).catch(() => {});
  }, []);

  const fetchPreferences = useCallback(async () => {
    try {
      const [selectedRes, recentRes] = await Promise.all([
        fetchSelectedModel(),
        fetchRecentModels(),
      ]);
      savedModelRef.current = selectedRes.modelKey || "";
      recentModelsRef.current = recentRes.modelKeys || [];
      setRecentModelsCache(recentModelsRef.current);
    } catch {
      // Backend not ready yet, will retry when URL is set
    }
  }, []);

  const loadModels = useCallback(async (forceRefresh = false): Promise<void> => {
    const loadId = ++activeLoadIdRef.current;
    activeChannelRef.current?.abort();
    activeChannelRef.current = null;

    if (!forceRefresh) {
      const cached = getCachedModels();
      if (cached) {
        setModels(cached.models);
        setConnectedProviders(cached.connectedProviders);
        setIsLoading(false);
        selectModel(cached.models);
        return;
      }
    }

    setIsLoading(true);

    const controller = new AbortController();
    activeChannelRef.current = controller;

    const providerState = buildProviderState(modelsRef.current);
    let latestModels = modelsRef.current;
    let latestConnectedProviders = connectedProvidersRef.current;
    let selectedDuringLoad = false;
    let sawStartedEvent = false;
    let expectedProviders = new Set<string>();
    const seenProviders = new Set<string>();

    const isCurrentLoad = () => activeLoadIdRef.current === loadId;

    const syncModelsFromProviders = () => {
      latestModels = syncModelsFromProviderState(providerState);
      setModels(latestModels);
    };

    const syncConnectedProviders = (nextConnectedProviders: string[]) => {
      latestConnectedProviders = nextConnectedProviders;
      setConnectedProviders(nextConnectedProviders);
    };

    const maybeSelectModel = (isCompleted: boolean) => {
      if (selectedDuringLoad) return;
      if (forceRefresh && !isCompleted) return;
      if (latestModels.length === 0 && !isCompleted) return;
      selectModel(latestModels);
      selectedDuringLoad = true;
    };

    try {
      for await (const payload of toAsyncIterable(streamAvailableModels({ signal: controller.signal }))) {
        if (!isCurrentLoad() || controller.signal.aborted) break;
        const event = payload as ModelsStreamEvent;

        if (event.event === "ModelsStarted") {
          sawStartedEvent = true;
          const nextExpectedProviders = [...(event.expectedProviders || [])];
          expectedProviders = new Set(nextExpectedProviders);
          reorderProviderState(providerState, nextExpectedProviders);
          syncModelsFromProviders();
          continue;
        }

        if (event.event === "ModelsBatch") {
          if (!event.provider) continue;
          seenProviders.add(event.provider);
          upsertProvider(providerState, event.provider, [...(event.models || [])]);
          syncModelsFromProviders();
          syncConnectedProviders([...(event.connectedProviders || latestConnectedProviders)]);
          maybeSelectModel(false);
          continue;
        }

        if (event.event === "ModelsFailed") {
          if (!event.provider) continue;
          seenProviders.add(event.provider);
          removeProvider(providerState, event.provider);
          syncModelsFromProviders();
          syncConnectedProviders(
            [...(event.connectedProviders || latestConnectedProviders)].filter(
              (provider) => provider !== event.provider,
            ),
          );
          maybeSelectModel(false);
          continue;
        }

        if (event.event === "ModelsCompleted") {
          if (sawStartedEvent) {
            pruneProviderState(providerState, expectedProviders, seenProviders);
          }
          syncModelsFromProviders();
          syncConnectedProviders([...(event.connectedProviders || latestConnectedProviders)]);
          maybeSelectModel(true);
          setCachedModels(latestModels, latestConnectedProviders);
          break;
        }
      }
    } catch (error) {
      if (isCurrentLoad() && !controller.signal.aborted) {
        console.error("Failed to load models:", error);
      }
    } finally {
      if (isCurrentLoad()) {
        setIsLoading(false);
        if (activeChannelRef.current === controller) activeChannelRef.current = null;
      }
    }
  }, [selectModel]);

  useEffect(() => {
    fetchPreferences().then(() => loadModels());

    const unsubscribe = subscribeBackendBaseUrl(() => {
      fetchPreferences().then(() => loadModels(true));
    });

    return () => {
      unsubscribe();
      activeChannelRef.current?.abort();
      activeChannelRef.current = null;
    };
  }, [loadModels, fetchPreferences]);

  const updateSelectedModel = useCallback((model: string) => {
    setSelectedModel(model);
    savedModelRef.current = model;
    saveSelectedModel({ body: { modelKey: model } }).catch(() => {});
  }, []);

  const refreshModels = useCallback(() => loadModels(true), [loadModels]);

  return {
    selectedModel,
    setSelectedModel: updateSelectedModel,
    models,
    connectedProviders,
    isLoading,
    refreshModels,
  };
}
