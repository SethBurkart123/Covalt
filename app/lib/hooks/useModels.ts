import { useState, useEffect, useCallback, useRef } from "react";
import { streamAvailableModels } from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";
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
  models: ModelInfo[];
  connectedProviders: string[];
  timestamp: number;
}

interface ModelsStreamEvent {
  event: "ModelsStarted" | "ModelsBatch" | "ModelsFailed" | "ModelsCompleted" | string;
  provider?: string;
  models?: ModelInfo[];
  connectedProviders?: string[];
  expectedProviders?: string[];
}

function getCachedModels(): { models: ModelInfo[]; connectedProviders: string[] } | null {
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

function setCachedModels(models: ModelInfo[], connectedProviders: string[]): void {
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeChannelRef = useRef<ReturnType<typeof streamAvailableModels> | null>(null);
  const activeLoadIdRef = useRef(0);
  const modelsRef = useRef<ModelInfo[]>([]);
  const connectedProvidersRef = useRef<string[]>([]);

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  useEffect(() => {
    connectedProvidersRef.current = connectedProviders;
  }, [connectedProviders]);

  const selectModel = useCallback((nextModels: ModelInfo[]) => {
    if (nextModels.length === 0) {
      setSelectedModel("");
      return;
    }

    const saved = localStorage.getItem("selectedModel");
    if (
      saved &&
      (saved.startsWith("agent:") || nextModels.some((m) => `${m.provider}:${m.modelId}` === saved))
    ) {
      setSelectedModel(saved);
      return;
    }

    const defaultModel = nextModels.find((m) => m.isDefault) || nextModels[0];
    const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
    setSelectedModel(modelKey);
    localStorage.setItem("selectedModel", modelKey);
  }, []);

  const loadModels = useCallback((forceRefresh = false): Promise<void> => {
    const loadId = ++activeLoadIdRef.current;
    activeChannelRef.current?.close();
    activeChannelRef.current = null;

    if (!forceRefresh) {
      const cached = getCachedModels();
      if (cached) {
        setModels(cached.models);
        setConnectedProviders(cached.connectedProviders);
        setIsLoading(false);
        selectModel(cached.models);
        return Promise.resolve();
      }
    }

    setIsLoading(true);

    return new Promise<void>((resolve) => {
      const channel = streamAvailableModels();
      activeChannelRef.current = channel;

      const providerState = buildProviderState(modelsRef.current);
      let latestModels = modelsRef.current;
      let latestConnectedProviders = connectedProvidersRef.current;
      let selectedDuringLoad = false;
      let settled = false;
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
        if (forceRefresh || selectedDuringLoad) return;
        if (latestModels.length === 0 && !isCompleted) return;
        selectModel(latestModels);
        selectedDuringLoad = true;
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        if (isCurrentLoad()) {
          setIsLoading(false);
          if (activeChannelRef.current === channel) activeChannelRef.current = null;
        }
        resolve();
      };

      channel.subscribe((payload) => {
        if (!isCurrentLoad()) return;

        const event = payload as ModelsStreamEvent;

        if (event.event === "ModelsStarted") {
          sawStartedEvent = true;
          const nextExpectedProviders = event.expectedProviders || [];
          expectedProviders = new Set(nextExpectedProviders);
          reorderProviderState(providerState, nextExpectedProviders);
          syncModelsFromProviders();
          return;
        }

        if (event.event === "ModelsBatch") {
          if (!event.provider) return;
          seenProviders.add(event.provider);
          upsertProvider(providerState, event.provider, event.models || []);
          syncModelsFromProviders();
          syncConnectedProviders(event.connectedProviders || latestConnectedProviders);
          maybeSelectModel(false);
          return;
        }

        if (event.event === "ModelsFailed") {
          if (!event.provider) return;
          seenProviders.add(event.provider);
          removeProvider(providerState, event.provider);
          syncModelsFromProviders();
          syncConnectedProviders(
            (event.connectedProviders || latestConnectedProviders).filter(
              (provider) => provider !== event.provider,
            ),
          );
          maybeSelectModel(false);
          return;
        }

        if (event.event === "ModelsCompleted") {
          if (sawStartedEvent) {
            pruneProviderState(providerState, expectedProviders, seenProviders);
          }

          syncModelsFromProviders();
          syncConnectedProviders(event.connectedProviders || latestConnectedProviders);
          maybeSelectModel(true);
          setCachedModels(latestModels, latestConnectedProviders);
          finish();
        }
      });

      channel.onError((error) => {
        if (isCurrentLoad()) {
          console.error("Failed to load models:", error.message);
        }
        finish();
      });

      channel.onClose(() => {
        finish();
      });
    });
  }, [selectModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => () => {
    activeChannelRef.current?.close();
    activeChannelRef.current = null;
  }, []);

  const updateSelectedModel = useCallback((model: string) => {
    setSelectedModel(model);
    localStorage.setItem("selectedModel", model);
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
