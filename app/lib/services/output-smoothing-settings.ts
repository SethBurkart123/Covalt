"use client";

import { request } from "@/python/_internal";
import {
  DEFAULT_OUTPUT_SMOOTHING_DELAY_MS,
  normalizeOutputSmoothingDelayMs,
} from "@/lib/services/output-smoothing";

export interface OutputSmoothingSettings {
  enabled?: boolean;
  delayMs?: number;
}

let cachedSettings: Required<OutputSmoothingSettings> | null = null;

function normalizeSettings(settings: OutputSmoothingSettings): Required<OutputSmoothingSettings> {
  return {
    enabled: settings.enabled ?? false,
    delayMs: normalizeOutputSmoothingDelayMs(
      settings.delayMs ?? DEFAULT_OUTPUT_SMOOTHING_DELAY_MS,
    ),
  };
}

export function getOutputSmoothingSettings(): Promise<OutputSmoothingSettings> {
  return request("get_output_smoothing_settings", {});
}

export function saveOutputSmoothingSettings(settings: OutputSmoothingSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  return request("save_output_smoothing_settings", { body: normalized });
}

export async function getOutputSmoothingConfig(): Promise<Required<OutputSmoothingSettings>> {
  if (cachedSettings) return cachedSettings;

  try {
    cachedSettings = normalizeSettings(await getOutputSmoothingSettings());
  } catch (error) {
    console.error("Failed to load output smoothing settings", error);
    cachedSettings = normalizeSettings({});
  }

  return cachedSettings;
}

export async function getOutputSmoothingEnabled(): Promise<boolean> {
  return (await getOutputSmoothingConfig()).enabled;
}

export function setCachedOutputSmoothingSettings(settings: OutputSmoothingSettings): void {
  cachedSettings = normalizeSettings(settings);
}
