"use client";

import { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import ModelSelector from "@/components/ModelSelector";
import { useChat } from "@/contexts/chat-context";
import {
  normalizeSelectionSettings,
  normalizeSelectionState,
  type ModelSelectionMode,
} from "@/lib/services/model-selection";

export default function ModelSelectionDefaultsPanel() {
  const {
    models,
    selectedModel,
    modelSelectionState,
    modelSelectionSettings,
    setModelSelectionSettings,
  } = useChat();

  const currentSelection = normalizeSelectionState({
    ...modelSelectionState,
    modelKey: selectedModel,
  });

  const updateMode = useCallback(
    (mode: ModelSelectionMode) => {
      const fixedSelection =
        mode === "fixed" && !modelSelectionSettings.fixedSelection.modelKey
          ? currentSelection
          : modelSelectionSettings.fixedSelection;
      setModelSelectionSettings(
        normalizeSelectionSettings({
          ...modelSelectionSettings,
          mode,
          fixedSelection,
        }),
      );
    },
    [currentSelection, modelSelectionSettings, setModelSelectionSettings],
  );

  const updateFixedSelection = useCallback(
    (modelKey: string) => {
      const currentFixed = modelSelectionSettings.fixedSelection;
      setModelSelectionSettings(
        normalizeSelectionSettings({
          ...modelSelectionSettings,
          mode: "fixed",
          fixedSelection:
            currentFixed.modelKey === modelKey
              ? currentFixed
              : { modelKey, modelOptions: {}, variables: {} },
        }),
      );
    },
    [modelSelectionSettings, setModelSelectionSettings],
  );

  const fixedModelKey =
    modelSelectionSettings.fixedSelection.modelKey || selectedModel;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Default Model</h2>
      <div className="space-y-3">
        <RadioGroup
          value={modelSelectionSettings.mode}
          onValueChange={(value) => updateMode(value as ModelSelectionMode)}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="last_used" id="model-default-last-used" />
            <Label
              htmlFor="model-default-last-used"
              className="font-normal cursor-pointer"
            >
              Last selected
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="fixed" id="model-default-fixed" />
            <Label
              htmlFor="model-default-fixed"
              className="font-normal cursor-pointer"
            >
              Fixed default
            </Label>
          </div>
        </RadioGroup>

        {modelSelectionSettings.mode === "fixed" && (
          <div className="ml-6 max-w-md">
            <ModelSelector
              selectedModel={fixedModelKey}
              setSelectedModel={updateFixedSelection}
              models={models}
            />
          </div>
        )}
      </div>
    </section>
  );
}
