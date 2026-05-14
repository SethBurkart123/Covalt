
import { useEffect, useState, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { getModelSettings, saveModelSettings } from "@/python/api";
import type { ModelSettingsInfo } from "@/python/api";
import { useModels } from "@/lib/hooks/useModels";
import ModelChipSelector from "./ModelChipSelector";

export default function ModelSettingsPanel() {
  const { models, isLoading: modelsLoading } = useModels();
  const [modelSettings, setModelSettings] = useState<readonly ModelSettingsInfo[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModelSettings = useCallback(async () => {
    setSettingsLoading(true);
    setError(null);
    try {
      const settings = await getModelSettings();
      setModelSettings(settings.models);
    } catch (err) {
      console.error("Failed to load model settings", err);
      setError("Failed to load model settings. Please try again.");
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModelSettings();
  }, [loadModelSettings]);

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
      thinkingTagPrompted: update.thinkingTagPrompted ?? existing?.thinkingTagPrompted,
    };

    const previousSettings = modelSettings;
    const hasExisting = previousSettings.some(
      (m) => m.provider === provider && m.modelId === modelId
    );

    const optimisticSettings = hasExisting
      ? previousSettings.map((m) =>
          m.provider === provider && m.modelId === modelId ? newSetting : m
        )
      : [...previousSettings, newSetting];

    setError(null);
    setSettingsSaving(true);
    setModelSettings(optimisticSettings);

    try {
      await saveModelSettings({ body: newSetting });
      const settings = await getModelSettings();
      setModelSettings(settings.models);
    } catch (err) {
      console.error("Failed to save model settings", err);
      setModelSettings(previousSettings);
      setError("Failed to save model settings. Please try again.");
    } finally {
      setSettingsSaving(false);
    }
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Model Behavior</h2>
        {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
