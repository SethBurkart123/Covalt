"use client";

import { useEffect, useState, useMemo } from "react";
import { MessageSquareCode, Brain } from "lucide-react";
import {
  getModelSettings,
  saveModelSettings,
  getAvailableModels,
} from "@/python/api";
import type { ModelSettingsInfo } from "@/python/api";
import { Card } from "@/components/ui/card";
import ModelChipSelector from "./ModelChipSelector";

type Model = {
  provider: string;
  modelId: string;
  displayName: string;
};

export default function ModelSettingsPanel() {
  const [modelSettings, setModelSettings] = useState<ModelSettingsInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [settings, models] = await Promise.all([
        getModelSettings(),
        getAvailableModels(),
      ]);
      setModelSettings(settings.models);
      setAvailableModels(
        models.models.map((m) => ({
          provider: m.provider,
          modelId: m.modelId,
          displayName: m.displayName,
        })),
      );
    } catch (error) {
      console.error("Failed to load model settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshModelSettings = async () => {
    try {
      const settings = await getModelSettings();
      setModelSettings(settings.models);
    } catch (error) {
      console.error("Failed to refresh model settings:", error);
    }
  };

  const getModelSetting = (
    provider: string,
    modelId: string,
  ): ModelSettingsInfo | undefined => {
    return modelSettings.find(
      (m) => m.provider === provider && m.modelId === modelId,
    );
  };

  const parseThinkTagsModels = useMemo(
    () =>
      availableModels.filter(
        (model) => getModelSetting(model.provider, model.modelId)?.parseThinkTags ?? false
      ),
    [availableModels, modelSettings]
  );

  const reasoningModels = useMemo(
    () =>
      availableModels.filter(
        (model) => getModelSetting(model.provider, model.modelId)?.reasoning?.supports ?? false
      ),
    [availableModels, modelSettings]
  );

  const handleAddParseThinkTags = async (provider: string, modelId: string) => {
    const newSetting: ModelSettingsInfo = {
      provider,
      modelId,
      parseThinkTags: true,
      reasoning: getModelSetting(provider, modelId)?.reasoning ?? {
        supports: false,
        isUserOverride: false,
      },
    };

    setModelSettings((prev) =>
      prev.find((m) => m.provider === provider && m.modelId === modelId)
        ? prev.map((m) => (m.provider === provider && m.modelId === modelId ? newSetting : m))
        : [...prev, newSetting]
    );

    try {
      await saveModelSettings({ body: newSetting });
      refreshModelSettings();
    } catch (error) {
      console.error("Failed to save model settings:", error);
      refreshModelSettings();
    }
  };

  const handleRemoveParseThinkTags = async (provider: string, modelId: string) => {
    const newSetting: ModelSettingsInfo = {
      provider,
      modelId,
      parseThinkTags: false,
      reasoning: getModelSetting(provider, modelId)?.reasoning ?? {
        supports: false,
        isUserOverride: false,
      },
    };

    setModelSettings((prev) =>
      prev.find((m) => m.provider === provider && m.modelId === modelId)
        ? prev.map((m) => (m.provider === provider && m.modelId === modelId ? newSetting : m))
        : [...prev, newSetting]
    );

    try {
      await saveModelSettings({ body: newSetting });
      refreshModelSettings();
    } catch (error) {
      console.error("Failed to save model settings:", error);
      refreshModelSettings();
    }
  };

  const handleAddReasoning = async (provider: string, modelId: string) => {
    const newSetting: ModelSettingsInfo = {
      provider,
      modelId,
      parseThinkTags: getModelSetting(provider, modelId)?.parseThinkTags ?? false,
      reasoning: {
        supports: true,
        isUserOverride: true,
      },
    };

    setModelSettings((prev) =>
      prev.find((m) => m.provider === provider && m.modelId === modelId)
        ? prev.map((m) => (m.provider === provider && m.modelId === modelId ? newSetting : m))
        : [...prev, newSetting]
    );

    try {
      await saveModelSettings({ body: newSetting });
      refreshModelSettings();
    } catch (error) {
      console.error("Failed to save model settings:", error);
      refreshModelSettings();
    }
  };

  const handleRemoveReasoning = async (provider: string, modelId: string) => {
    const newSetting: ModelSettingsInfo = {
      provider,
      modelId,
      parseThinkTags: getModelSetting(provider, modelId)?.parseThinkTags ?? false,
      reasoning: {
        supports: false,
        isUserOverride: true,
      },
    };

    setModelSettings((prev) =>
      prev.find((m) => m.provider === provider && m.modelId === modelId)
        ? prev.map((m) => (m.provider === provider && m.modelId === modelId ? newSetting : m))
        : [...prev, newSetting]
    );

    try {
      await saveModelSettings({ body: newSetting });
      refreshModelSettings();
    } catch (error) {
      console.error("Failed to save model settings:", error);
      refreshModelSettings();
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-muted-foreground">
        Loading model settings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/70 py-4 gap-0">
        <div className="px-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted flex items-center justify-center p-2">
              <MessageSquareCode size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium leading-none flex items-center gap-2">
                Parse Think Tags
                {parseThinkTagsModels.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {parseThinkTagsModels.length} model{parseThinkTagsModels.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Extract reasoning from &lt;think&gt; tags in responses
              </div>
            </div>
          </div>
          <ModelChipSelector
            selectedModels={parseThinkTagsModels}
            availableModels={availableModels}
            onAdd={handleAddParseThinkTags}
            onRemove={handleRemoveParseThinkTags}
          />
        </div>
      </Card>

      <Card className="overflow-hidden border-border/70 py-4 gap-0">
        <div className="px-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted flex items-center justify-center p-2">
              <Brain size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium leading-none flex items-center gap-2">
                Reasoning Models
                {reasoningModels.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {reasoningModels.length} model{reasoningModels.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Mark models that natively output thinking/reasoning content
              </div>
            </div>
          </div>
          <ModelChipSelector
            selectedModels={reasoningModels}
            availableModels={availableModels}
            onAdd={handleAddReasoning}
            onRemove={handleRemoveReasoning}
          />
        </div>
      </Card>

      {availableModels.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          No models configured yet. Add providers in the Providers tab.
        </div>
      )}
    </div>
  );
}
