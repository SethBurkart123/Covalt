import { useState, useEffect } from 'react';

export function useModels() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load available models from env at startup.
    // Format: comma-separated IDs, optionally with provider hints.
    const envModels = (process.env.NEXT_PUBLIC_AVAILABLE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);

    const available = envModels.length > 0
      ? envModels
      : (process.env.OPENAI_MODEL ? [process.env.OPENAI_MODEL] : []);
    setModels(available);

    // Restore persisted selection or default to first.
    if (available.length > 0) {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedModel') : null;
      if (saved && available.includes(saved)) {
        setSelectedModel(saved);
      } else {
        setSelectedModel(available[0]);
        if (typeof window !== 'undefined') {
          localStorage.setItem('selectedModel', available[0]);
        }
      }
    } else {
      setSelectedModel('');
    }

    setIsLoading(false);
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
