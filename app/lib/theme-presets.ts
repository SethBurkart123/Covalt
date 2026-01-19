import type { ThemePreset, ThemeStyles, ThemeStyleProps } from "./types";
import { themes } from "@/themes";

const EMPTY_STYLES: ThemeStyleProps = {};

export const defaultThemeState = {
  currentMode: "light" as const,
  preset: "default",
  styles: {
    light: EMPTY_STYLES,
    dark: EMPTY_STYLES,
  },
};

export const defaultPreviewStyles: ThemeStyles = (() => {
  const theme = themes["default"];
  if (!theme) return defaultThemeState.styles;

  return {
    light: theme.styles.light,
    dark: theme.styles.dark ?? theme.styles.light,
  };
})();

export const presets: Record<string, ThemePreset> = Object.fromEntries(
  Object.entries(themes).map(([id, theme]) => [
    id,
    {
      label: theme.name,
      createdAt: theme.createdAt,
      styles: {
        light: theme.styles.light,
        dark: theme.styles.dark,
      },
    } satisfies ThemePreset,
  ])
);

export function getPresetThemeStyles(name: string): ThemeStyles {
  if (name === "default") return defaultThemeState.styles;

  const preset = presets[name];
  if (!preset) return defaultThemeState.styles;

  const light = preset.styles.light ?? {};
  return {
    light,
    dark: { ...light, ...(preset.styles.dark ?? {}) },
  };
}
