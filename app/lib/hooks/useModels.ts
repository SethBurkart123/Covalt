import { useState, useEffect, useCallback, useRef } from "react";
import {
  streamAvailableModels,
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
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [connectedProviders, setConnectedProviders] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeChannelRef = useRef<AbortController | null>(null);
  const activeLoadIdRef = useRef(0);
  const modelsRef = useRef<readonly ModelInfo[]>([]);
  const connectedProvidersRef = useRef<readonly string[]>([]);

  modelsRef.current = models;
  connectedProvidersRef.current = connectedProviders;

  const fetchRecentModelCache = useCallback(async () => {
    try {
      const recentRes = await fetchRecentModels();
      setRecentModelsCache(recentRes.modelKeys || []);
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
        return;
      }
    }

    setIsLoading(true);

    const controller = new AbortController();
    activeChannelRef.current = controller;

    const providerState = buildProviderState(modelsRef.current);
    let latestModels = modelsRef.current;
    let latestConnectedProviders = connectedProvidersRef.current;
    let sawStartedEvent = false;
    let expectedProviders = new Set<string>();
    const seenProviders = new Set<string>();

    const isCurrentLoad = () => activeLoadIdRef.current === loadId;

    const syncModelsFromProviders = () => {
      latestModels = syncModelsFromProviderState(providerState);
      setModels(latestModels);
    };

    const syncConnectedProviders = (nextConnectedProviders: readonly string[]) => {
      latestConnectedProviders = nextConnectedProviders;
      setConnectedProviders(nextConnectedProviders);
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
          continue;
        }

        if (event.event === "ModelsCompleted") {
          if (sawStartedEvent) {
            pruneProviderState(providerState, expectedProviders, seenProviders);
          }
          syncModelsFromProviders();
          syncConnectedProviders([...(event.connectedProviders || latestConnectedProviders)]);
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
  }, []);

  useEffect(() => {
    fetchRecentModelCache().then(() => loadModels());

    const unsubscribe = subscribeBackendBaseUrl(() => {
      fetchRecentModelCache().then(() => loadModels(true));
    });

    return () => {
      unsubscribe();
      activeChannelRef.current?.abort();
      activeChannelRef.current = null;
    };
  }, [loadModels, fetchRecentModelCache]);

  const refreshModels = useCallback(() => loadModels(true), [loadModels]);

  return {
    models,
    connectedProviders,
    isLoading,
    refreshModels,
  };
}
