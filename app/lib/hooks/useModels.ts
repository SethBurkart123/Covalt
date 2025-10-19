import { useState, useEffect } from 'react';
import { getAvailableModels } from '@/python/apiClient';
import type { ModelInfo } from '@/lib/types/chat';

export function useModels() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load available models from backend
    const loadModels = async () => {
      try {
        const response = await getAvailableModels(undefined);
        const availableModels = response.models;
        setModels(availableModels);

        // Restore persisted selection or default to first
        if (availableModels.length > 0) {
          const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedModel') : null;
          
          // Check if saved model exists in available models
          const savedExists = saved && availableModels.some(
            m => `${m.provider}:${m.modelId}` === saved
          );
          
          if (savedExists && saved) {
            setSelectedModel(saved);
          } else {
            // Default to first model or the one marked as default
            const defaultModel = availableModels.find(m => m.isDefault === true) || availableModels[0];
            const modelKey = `${defaultModel.provider}:${defaultModel.modelId}`;
            setSelectedModel(modelKey);
            if (typeof window !== 'undefined') {
              localStorage.setItem('selectedModel', modelKey);
            }
          }
        } else {
          setSelectedModel('');
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        setModels([]);
        setSelectedModel('');
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();
  }, []);

  const updateSelectedModel = (model: string) => {
    setSelectedModel(model);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedModel', model);
    }
  };

  return {
    selectedModel,
    setSelectedModel: updateSelectedModel,
    models,
    isLoading,
  };
}
