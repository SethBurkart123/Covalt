"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { getSystemPromptSettings, saveSystemPromptSettings } from "@/python/api";

export default function SystemPromptPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [prompt, setPrompt] = useState("");

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (pendingSaveRef.current !== null) {
        saveSystemPromptSettings({ body: { prompt: pendingSaveRef.current } });
      }
    };
  }, []);

  const performSave = async (newPrompt: string) => {
    setIsSaving(true);
    try {
      await saveSystemPromptSettings({ body: { prompt: newPrompt } });
    } catch (e) {
      console.error("Failed to save system prompt settings", e);
    } finally {
      setIsSaving(false);
      pendingSaveRef.current = null;
    }
  };

  const debouncedSave = useCallback((newPrompt: string) => {
    pendingSaveRef.current = newPrompt;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      performSave(newPrompt);
    }, 500);
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await getSystemPromptSettings();
      setPrompt(response.prompt ?? "");
    } catch (e) {
      console.error("Failed to load system prompt settings", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (value: string) => {
    setPrompt(value);
    debouncedSave(value);
  };

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Custom System Prompt</h2>
        <div className="flex items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Custom System Prompt</h2>
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="system-prompt">System Prompt</Label>
        <textarea
          id="system-prompt"
          value={prompt}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full min-h-[120px] p-2 text-sm rounded-md border border-input bg-background resize-y"
          placeholder="Enter custom instructions for the AI assistant..."
        />
        <p className="text-xs text-muted-foreground">
          This prompt will be included in all conversations as instructions for the AI.
        </p>
      </div>
    </section>
  );
}
