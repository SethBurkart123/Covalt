"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { getAutoTitleSettings, saveAutoTitleSettings } from "@/python/api";
import ModelSelector from "@/components/ModelSelector";
import { useModels } from "@/lib/hooks/useModels";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface AutoTitleSettings {
  enabled: boolean;
  prompt: string;
  modelMode: "current" | "specific";
  provider: string;
  modelId: string;
}

export default function AutoTitlePanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<AutoTitleSettings>({
    enabled: true,
    prompt:
      "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
    modelMode: "current",
    provider: "openai",
    modelId: "gpt-4o-mini",
  });

  const { models } = useModels();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<AutoTitleSettings | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (pendingSaveRef.current) saveAutoTitleSettings({
        body: {
          enabled: pendingSaveRef.current.enabled,
          prompt: pendingSaveRef.current.prompt,
          modelMode: pendingSaveRef.current.modelMode,
          provider: pendingSaveRef.current.provider,
          modelId: pendingSaveRef.current.modelId,
        },
      });
    };
  }, []);

  const performSave = async (settingsToSave: AutoTitleSettings) => {
    setIsSaving(true);
    try {
      await saveAutoTitleSettings({
        body: {
          enabled: settingsToSave.enabled,
          prompt: settingsToSave.prompt,
          modelMode: settingsToSave.modelMode,
          provider: settingsToSave.provider,
          modelId: settingsToSave.modelId,
        },
      });
    } catch (e) {
      console.error("Failed to save auto-title settings", e);
    } finally {
      setIsSaving(false);
      pendingSaveRef.current = null;
    }
  };

  const debouncedSave = useCallback((newSettings: AutoTitleSettings) => {
    pendingSaveRef.current = newSettings;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      performSave(newSettings);
    }, 500);
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await getAutoTitleSettings();
      setSettings({
        enabled: response.enabled ?? true,
        prompt: response.prompt ?? "",
        modelMode: response.modelMode as "current" | "specific",
        provider: response.provider ?? "openai",
        modelId: response.modelId ?? "gpt-4o-mini",
      });
    } catch (e) {
      console.error("Failed to load auto-title settings", e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = (updates: Partial<AutoTitleSettings>) => {
    setSettings({ ...settings, ...updates });
    debouncedSave({ ...settings, ...updates });
  };

  const handleModelChange = (modelKey: string) => {
    const [provider, modelId] = modelKey.split(":", 2);
    updateSettings({ provider, modelId });
  };

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Auto-Generate Titles</h2>
        <div className="flex items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Auto-Generate Titles</h2>
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="auto-title-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              updateSettings({ enabled: checked === true })
            }
          />
          <Label htmlFor="auto-title-enabled" className="font-medium cursor-pointer">
            Enable Auto-Title Generation
          </Label>
        </div>

        {settings.enabled && (
          <>
            <div className="space-y-2">
              <Label htmlFor="title-prompt">
                Title Generation Prompt
              </Label>
              <textarea
                id="title-prompt"
                value={settings.prompt}
                onChange={(e) =>
                  updateSettings({ prompt: e.target.value })
                }
                className="w-full min-h-[100px] p-2 text-sm rounded-md border border-input bg-background"
                placeholder="Enter the prompt for generating titles..."
              />
              <p className="text-xs text-muted-foreground">
                Tip:{" "}
                <code className="px-1 py-0.5 bg-muted rounded">
                  {"{{ message }}"}
                </code>{" "}
                as a placeholder for the user&apos;s first message
              </p>
            </div>

            <div className="space-y-3">
              <Label>Model Selection</Label>
              <RadioGroup
                value={settings.modelMode}
                onValueChange={(value) =>
                  updateSettings({
                    modelMode: value as "current" | "specific",
                  })
                }
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="current" id="model-current" />
                  <Label
                    htmlFor="model-current"
                    className="font-normal cursor-pointer"
                  >
                    Use Current Chat Model
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="specific"
                    id="model-specific"
                  />
                  <Label
                    htmlFor="model-specific"
                    className="font-normal cursor-pointer"
                  >
                    Use Specific Model
                  </Label>
                </div>
              </RadioGroup>

              {settings.modelMode === "specific" && (
                <div className="ml-6 mt-2">
                  <ModelSelector
                    selectedModel={`${settings.provider}:${settings.modelId}`}
                    setSelectedModel={handleModelChange}
                    models={models}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
