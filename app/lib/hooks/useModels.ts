import { useState, useEffect, useCallback } from "react";
import { getAvailableModels } from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";

const CACHE_KEY = "modelsCache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ModelsCache {
  models: ModelInfo[];
  connectedProviders: string[];
  timestamp: number;
}

function getCachedModels(): { models: ModelInfo[]; connectedProviders: string[] } | null {
  if (typeof window === "undefined") return null;
  
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  try {
    const { models, connectedProviders, timestamp }: ModelsCache = JSON.parse(cached);
    return Date.now() - timestamp > CACHE_TTL ? null : { models, connectedProviders };
  } catch {
    return null;
  }
}

function setCachedModels(models: ModelInfo[], connectedProviders: string[]): void {
  if (typeof window === "undefined") return;
  
  const cache: ModelsCache = {
    models,
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

  const selectModel = useCallback((models: ModelInfo[]) => {
    if (models.length === 0) {
      setSelectedModel("");
      return;
    }

    const saved = localStorage.getItem("selectedModel");
    if (saved && models.some((m) => `${m.provider}:${m.modelId}` === saved)) {
      setSelectedModel(saved);
    } else {
      const defaultModel = models.find((m) => m.isDefault) || models[0];
      const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
      setSelectedModel(modelKey);
      localStorage.setItem("selectedModel", modelKey);
    }
  }, []);

  const loadModels = useCallback(async (forceRefresh = false) => {
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

    try {
      const response = await getAvailableModels();
      setModels(response.models);
      setConnectedProviders(response.connectedProviders || []);
      setCachedModels(response.models, response.connectedProviders || []);
      selectModel(response.models);
    } catch (error) {
      console.error("Failed to load models:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const updateSelectedModel = useCallback((model: string) => {
    setSelectedModel(model);
    localStorage.setItem("selectedModel", model);
  }, []);

  const refreshModels = useCallback(() => {
    return loadModels(true);
  }, [loadModels]);

  return {
    selectedModel,
    setSelectedModel: updateSelectedModel,
    models,
    connectedProviders,
    isLoading,
    refreshModels,
  };
}
