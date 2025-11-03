"use client";

import React, { useEffect, useState } from 'react';
import { getModelSettings, saveModelSettings, getAvailableModels } from '@/python/apiClient';
import type { ModelSettingsInfo, ReasoningInfo } from '@/python/_apiTypes';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ModelSettingsPanel() {
  const [modelSettings, setModelSettings] = useState<ModelSettingsInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<Array<{ provider: string; modelId: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const [settings, models] = await Promise.all([
        getModelSettings(),
        getAvailableModels()
      ]);
      
      setModelSettings(settings.models);
      setAvailableModels(models.models.map(m => ({
        provider: m.provider,
        modelId: m.modelId,
        displayName: m.displayName
      })));
    } catch (error) {
      console.error('Failed to load model settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleReasoning = async (provider: string, modelId: string, currentReasoning: ReasoningInfo) => {
    const key = `${provider}:${modelId}:reasoning`;
    setSaving(key);
    
    try {
      await saveModelSettings({
        provider,
        modelId,
        parseThinkTags: getModelSetting(provider, modelId)?.parseThinkTags ?? false,
        reasoning: {
          supports: !currentReasoning.supports,
          isUserOverride: true,
        },
      });
      
      loadSettings();
    } catch (error) {
      console.error('Failed to save model settings:', error);
    } finally {
      setSaving(null);
    }
  };

  const handleToggleParseThinkTags = async (provider: string, modelId: string, currentValue: boolean) => {
    const key = `${provider}:${modelId}:parse`;
    setSaving(key);
    
    try {
      const setting = getModelSetting(provider, modelId);
      await saveModelSettings({
        provider,
        modelId,
        parseThinkTags: !currentValue,
        reasoning: setting?.reasoning,
      });
      
      loadSettings();
    } catch (error) {
      console.error('Failed to save model settings:', error);
    } finally {
      setSaving(null);
    }
  };

  const getModelSetting = (provider: string, modelId: string): ModelSettingsInfo | undefined => {
    return modelSettings.find(m => m.provider === provider && m.modelId === modelId);
  };

  const getDefaultReasoning = (): ReasoningInfo => ({
    supports: false,
    isUserOverride: false,
  });

  const groupedModels = availableModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, typeof availableModels>);

  if (loading) {
    return <div className="py-8 text-muted-foreground">Loading model settings...</div>;
  }

  return (
    <Card className="border-none shadow-none">
      <CardHeader className="px-0">
        <CardTitle>Model Settings</CardTitle>
        <CardDescription>
          Configure reasoning capabilities and parsing options for models.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 space-y-6">
        {Object.entries(groupedModels).map(([provider, models]) => (
          <div key={provider} className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground capitalize">
              {provider === 'google' ? 'Google AI Studio' : provider}
            </h3>
            <div className="space-y-3">
              {models.map(model => {
                const setting = getModelSetting(provider, model.modelId);
                const parseThinkTags = setting?.parseThinkTags ?? false;
                const reasoning = setting?.reasoning ?? getDefaultReasoning();
                const key = `${provider}:${model.modelId}`;
                const isSavingReasoning = saving === `${key}:reasoning`;
                const isSavingParse = saving === `${key}:parse`;

                return (
                  <div
                    key={key}
                    className="space-y-2 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <Label className="text-sm font-medium">
                          {model.displayName}
                        </Label>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {model.modelId}
                          {reasoning.isUserOverride && (
                            <span className="ml-2 text-blue-500">• Manual Override</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 pl-4 border-l-2 border-muted">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`${key}-parse`} className="text-xs cursor-pointer">
                          Parse think tags
                        </Label>
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`${key}-parse`}
                            checked={parseThinkTags}
                            onCheckedChange={() => handleToggleParseThinkTags(provider, model.modelId, parseThinkTags)}
                            disabled={isSavingParse}
                          />
                          {isSavingParse && (
                            <span className="text-xs text-muted-foreground">Saving...</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">Reasoning</div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`${key}-reasoning`} className="text-xs cursor-pointer">
                            Supports reasoning
                          </Label>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`${key}-reasoning`}
                              checked={reasoning.supports}
                              onCheckedChange={() => handleToggleReasoning(provider, model.modelId, reasoning)}
                              disabled={isSavingReasoning}
                            />
                            {isSavingReasoning && (
                              <span className="text-xs text-muted-foreground">Saving...</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        
        {availableModels.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            No models configured yet. Add providers in the Providers tab.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
