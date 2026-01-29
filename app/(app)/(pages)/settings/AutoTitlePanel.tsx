"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<AutoTitleSettings>({
    enabled: true,
    prompt:
      "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
    modelMode: "current",
    provider: "openai",
    modelId: "gpt-4o-mini",
  });

  const { models } = useModels();

  useEffect(() => {
    loadSettings();
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

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveAutoTitleSettings({
        body: {
          enabled: settings.enabled,
          prompt: settings.prompt,
          modelMode: settings.modelMode,
          provider: settings.provider,
          modelId: settings.modelId,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      console.error("Failed to save auto-title settings", e);
    } finally {
      setSaving(false);
    }
  };

  const handleModelChange = (modelKey: string) => {
    const [provider, modelId] = modelKey.split(":", 2);
    setSettings((prev) => ({ ...prev, provider, modelId }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Card className="overflow-hidden border-border/70 py-2 gap-0">
        <button
          className="w-full px-2 flex items-center justify-between transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center gap-3 text-left">
            <div className="rounded-md bg-muted flex items-center justify-center p-2">
              <Sparkles size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-medium leading-none flex items-center gap-2">
                Auto-Generate Titles
                {settings.enabled && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                    Enabled
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Automatically generate conversation titles from first message
              </div>
            </div>
          </div>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={16} className="text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 270, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="px-2 border-t border-border/60 pt-4 space-y-4 mt-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-title-enabled"
                    checked={settings.enabled}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, enabled: !!checked })
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
                          setSettings({ ...settings, prompt: e.target.value })
                        }
                        className="w-full min-h-[100px] p-2 text-sm rounded-md border border-input bg-background"
                        placeholder="Enter the prompt for generating titles..."
                      />
                      <p className="text-xs text-muted-foreground">
                        Tip: Use{" "}
                        <code className="px-1 py-0.5 bg-muted rounded">
                          {"{{ message }}"}
                        </code>{" "}
                        as a placeholder for the user's first message
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Label>Model Selection</Label>
                      <RadioGroup
                        value={settings.modelMode}
                        onValueChange={(value) =>
                          setSettings({
                            ...settings,
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

                <div className="flex items-center justify-end pt-1">
                  <Button
                    variant="secondary"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : saved ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
