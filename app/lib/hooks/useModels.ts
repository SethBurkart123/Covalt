import { useState, useEffect, useCallback } from "react";
import { getAvailableModels } from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";

const CACHE_KEY = "modelsCache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ModelsCache {
  models: ModelInfo[];
  timestamp: number;
}

function getCachedModels(): ModelInfo[] | null {
  if (typeof window === "undefined") return null;
  
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  try {
    const { models, timestamp }: ModelsCache = JSON.parse(cached);
    const isExpired = Date.now() - timestamp > CACHE_TTL;
    return isExpired ? null : models;
  } catch {
    return null;
  }
}

function setCachedModels(models: ModelInfo[]): void {
  if (typeof window === "undefined") return;
  
  const cache: ModelsCache = {
    models,
    timestamp: Date.now(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function useModels() {
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadModels = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCachedModels();
      if (cached) {
        setModels(cached);
        setIsLoading(false);
        
        // Set selected model from cache
        if (cached.length > 0) {
          const saved = localStorage.getItem("selectedModel");
          const savedExists = saved && cached.some((m) => `${m.provider}:${m.modelId}` === saved);
          
          if (savedExists && saved) {
            setSelectedModel(saved);
          } else {
            const defaultModel = cached.find((m) => m.isDefault) || cached[0];
            const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
            setSelectedModel(modelKey);
            localStorage.setItem("selectedModel", modelKey);
          }
        }
        return;
      }
    }

    try {
      const response = await getAvailableModels();
      const availableModels = response.models;
      
      setModels(availableModels);
      setCachedModels(availableModels);

      if (availableModels.length > 0) {
        const saved = localStorage.getItem("selectedModel");
        const savedExists = saved && availableModels.some((m) => `${m.provider}:${m.modelId}` === saved);

        if (savedExists && saved) {
          setSelectedModel(saved);
        } else {
          const defaultModel = availableModels.find((m) => m.isDefault) || availableModels[0];
          const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
          setSelectedModel(modelKey);
          localStorage.setItem("selectedModel", modelKey);
        }
      } else {
        setSelectedModel("");
      }
    } catch (error) {
      console.error("Failed to load models:", error);
      setModels([]);
      setSelectedModel("");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const updateSelectedModel = useCallback((model: string) => {
    setSelectedModel(model);
    localStorage.setItem("selectedModel", model);
  }, []);

  const refreshModels = useCallback(async () => {
    await loadModels(true);
  }, [loadModels]);

  return {
    selectedModel,
    setSelectedModel: updateSelectedModel,
    models,
    isLoading,
    refreshModels,
  };
}
