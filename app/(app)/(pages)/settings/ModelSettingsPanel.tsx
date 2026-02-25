"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { getModelSettings, saveModelSettings } from "@/python/api";
import type { ModelSettingsInfo } from "@/python/api";
import { useModels } from "@/lib/hooks/useModels";
import ModelChipSelector from "./ModelChipSelector";

export default function ModelSettingsPanel() {
  const { models, isLoading: modelsLoading } = useModels();
  const [modelSettings, setModelSettings] = useState<ModelSettingsInfo[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    loadModelSettings();
  }, []);

  const loadModelSettings = async () => {
    setSettingsLoading(true);
    const settings = await getModelSettings();
    setModelSettings(settings.models);
    setSettingsLoading(false);
  };

  const getModelSetting = useCallback(
    (provider: string, modelId: string): ModelSettingsInfo | undefined => {
      return modelSettings.find(
        (m) => m.provider === provider && m.modelId === modelId,
      );
    },
    [modelSettings]
  );

  const parseThinkTagsModels = useMemo(
    () =>
      models.filter(
        (model) => {
          const setting = getModelSetting(model.provider, model.modelId);
          if (!setting) return false;
          if (setting.parseThinkTags) return true;
          if (setting.thinkingTagPrompted?.declined) return false;
          return setting.reasoning?.supports ?? false;
        }
      ),
    [models, getModelSetting]
  );

  const reasoningModels = useMemo(
    () =>
      models.filter(
        (model) => getModelSetting(model.provider, model.modelId)?.reasoning?.supports ?? false
      ),
    [models, getModelSetting]
  );

  const updateModelSetting = async (
    provider: string,
    modelId: string,
    update: Partial<Omit<ModelSettingsInfo, 'provider' | 'modelId'>>
  ) => {
    const existing = getModelSetting(provider, modelId);
    const newSetting: ModelSettingsInfo = {
      provider,
      modelId,
      parseThinkTags: update.parseThinkTags ?? existing?.parseThinkTags ?? false,
      reasoning: update.reasoning ?? existing?.reasoning ?? {
        supports: false,
        isUserOverride: false,
      },
    };

    const hasExisting = modelSettings.some(m => m.provider === provider && m.modelId === modelId);
    setModelSettings(hasExisting
      ? modelSettings.map(m => m.provider === provider && m.modelId === modelId ? newSetting : m)
      : [...modelSettings, newSetting]
    );

    await saveModelSettings({ body: newSetting });
    const settings = await getModelSettings();
    setModelSettings(settings.models);
  };

  const handleAddParseThinkTags = (provider: string, modelId: string) =>
    updateModelSetting(provider, modelId, { parseThinkTags: true });

  const handleRemoveParseThinkTags = (provider: string, modelId: string) =>
    updateModelSetting(provider, modelId, { parseThinkTags: false });

  const handleAddReasoning = (provider: string, modelId: string) =>
    updateModelSetting(provider, modelId, { reasoning: { supports: true, isUserOverride: true } });

  const handleRemoveReasoning = (provider: string, modelId: string) =>
    updateModelSetting(provider, modelId, { reasoning: { supports: false, isUserOverride: true } });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Model Behavior</h2>

      <div className="space-y-5">
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Parse Think Tags</h3>
              {!modelsLoading && !settingsLoading && parseThinkTagsModels.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {parseThinkTagsModels.length} model{parseThinkTagsModels.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Extract reasoning from &lt;think&gt; tags in responses
            </p>
          </div>
          <ModelChipSelector
            selectedModels={parseThinkTagsModels}
            availableModels={models}
            onAdd={handleAddParseThinkTags}
            onRemove={handleRemoveParseThinkTags}
            loading={modelsLoading || settingsLoading}
          />
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Reasoning Models</h3>
              {!modelsLoading && !settingsLoading && reasoningModels.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {reasoningModels.length} model{reasoningModels.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Mark models that natively output thinking/reasoning content
            </p>
          </div>
          <ModelChipSelector
            selectedModels={reasoningModels}
            availableModels={models}
            onAdd={handleAddReasoning}
            onRemove={handleRemoveReasoning}
            loading={modelsLoading || settingsLoading}
          />
        </div>
      </div>

      {!modelsLoading && !settingsLoading && models.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          No models configured yet. Add providers in the Providers tab.
        </div>
      )}
    </section>
  );
}
