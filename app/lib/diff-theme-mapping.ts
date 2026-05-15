export interface DiffThemePair {
  light: string;
  dark: string;
}

export const DEFAULT_DIFF_THEME: DiffThemePair = {
  light: "pierre-light",
  dark: "gruvbox-dark-medium",
};

export const PRESET_DIFF_THEMES: Record<string, DiffThemePair> = {
  default: { light: "pierre-light", dark: "gruvbox-dark-soft" },
  "modern-minimal": { light: "pierre-light", dark: "min-dark" },
  perpetuity: { light: "pierre-light", dark: "tokyo-night" },
  "cosmic-night": { light: "pierre-light", dark: "catppuccin-mocha" },
  tangerine: { light: "pierre-light", dark: "nord" },
  "quantum-rose": { light: "pierre-light", dark: "laserwave" },
  nature: { light: "pierre-light", dark: "vesper" },
  "bold-tech": { light: "pierre-light", dark: "material-theme-palenight" },
  "elegant-luxury": { light: "pierre-light", dark: "gruvbox-dark-medium" },
  claude: { light: "pierre-light", dark: "gruvbox-dark-medium" },
  vercel: { light: "pierre-light", dark: "pierre-dark" },
};

const STORAGE_KEY = "diff-theme-overrides";

export function getDiffThemeOverrides(): Record<string, DiffThemePair> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DiffThemePair>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function setDiffThemeOverride(
  presetId: string,
  pair: DiffThemePair | null,
): Record<string, DiffThemePair> {
  if (typeof window === "undefined") return {};
  const current = getDiffThemeOverrides();
  if (pair === null) {
    delete current[presetId];
  } else {
    current[presetId] = pair;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* noop */
  }
  return current;
}

export function resolveDiffTheme(
  presetId: string | undefined,
  overrides: Record<string, DiffThemePair> = {},
): DiffThemePair {
  if (presetId && overrides[presetId]) return overrides[presetId];
  if (presetId && PRESET_DIFF_THEMES[presetId]) return PRESET_DIFF_THEMES[presetId];
  return DEFAULT_DIFF_THEME;
}

export const DIFF_THEME_OVERRIDES_EVENT = "diff-theme-overrides:changed";

export function emitDiffThemeOverridesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DIFF_THEME_OVERRIDES_EVENT));
}
