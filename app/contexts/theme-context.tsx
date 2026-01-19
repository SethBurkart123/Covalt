"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeStyleProps, ThemeStyles } from "@/lib/types";
import { presets, defaultThemeState, defaultPreviewStyles, getPresetThemeStyles } from "@/lib/theme-presets";

export type ThemeMode = "light" | "dark" | "system";

export interface CustomTheme {
  id: string;
  name: string;
  createdAt: string;
  styles: ThemeStyles;
}

export interface ThemeState {
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  preset: string;
  styles: ThemeStyles;
  customThemes: CustomTheme[];
}

type ThemeContextType = {
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  preset: string;
  styles: ThemeStyles;
  customThemes: CustomTheme[];

  setMode: (mode: ThemeMode) => void;
  setPreset: (presetId: string) => void;
  addCustomTheme: (name: string, styles: ThemeStyles) => string;
  updateCustomTheme: (id: string, name: string, styles: ThemeStyles) => void;
  deleteCustomTheme: (id: string) => void;
  importTweakCNTheme: (name: string, cssVariables: string) => string;

  getAllThemes: () => Array<{ id: string; name: string; styles: ThemeStyles; isCustom: boolean }>;
  getCurrentThemeStyles: () => ThemeStyleProps;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_MODE_KEY = "theme-mode";
const STORAGE_PRESET_KEY = "theme-preset";
const STORAGE_CUSTOM_THEMES_KEY = "theme-custom-themes";
const STORAGE_ACTIVE_STYLES_KEY = "theme-active-styles";

function getSystemPreference(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemPreference() : mode;
}

function parseCSSVariables(css: string): { light: ThemeStyleProps; dark: ThemeStyleProps } {
  const light: ThemeStyleProps = {};
  const dark: ThemeStyleProps = {};

  const rootMatch = css.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    const vars = rootMatch[1];
    const varMatches = vars.matchAll(/--([^:]+):\s*([^;]+);/g);
    for (const match of varMatches) {
      const name = match[1].trim();
      const value = match[2].trim();
      light[name] = value;
    }
  }

  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/);
  if (darkMatch) {
    const vars = darkMatch[1];
    const varMatches = vars.matchAll(/--([^:]+):\s*([^;]+);/g);
    for (const match of varMatches) {
      const name = match[1].trim();
      const value = match[2].trim();
      dark[name] = value;
    }
  }

  return { light, dark };
}

const THEME_CSS_VARS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground",
  "destructive", "destructive-foreground", "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "radius",
  "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
  "font-sans", "font-serif", "font-mono",
  "shadow-color", "shadow-opacity", "shadow-blur", "shadow-spread", "shadow-offset-x", "shadow-offset-y",
];

function clearThemeStyles(): void {
  const root = document.documentElement;
  for (const varName of THEME_CSS_VARS) root.style.removeProperty(`--${varName}`);
}

function applyThemeStyles(styles: ThemeStyleProps, isDefault: boolean): void {
  const root = document.documentElement;

  if (isDefault || Object.keys(styles).length === 0) {
    clearThemeStyles();
    return;
  }

  clearThemeStyles();

  for (const [key, value] of Object.entries(styles)) {
    if (value == null || value === "") continue;
    root.style.setProperty(`--${key}`, value);
  }
}

function applyDarkModeClass(isDark: boolean): void {
  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function readStoredCustomThemes(): CustomTheme[] {
  const raw = localStorage.getItem(STORAGE_CUSTOM_THEMES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CustomTheme[];
  } catch {
    return [];
  }
}

function readInitialThemeState(): ThemeState {
  const savedMode = localStorage.getItem(STORAGE_MODE_KEY) as ThemeMode | null;
  const mode: ThemeMode = savedMode ?? "system";
  const resolvedMode = resolveMode(mode);

  const preset = localStorage.getItem(STORAGE_PRESET_KEY) ?? "default";
  const customThemes = readStoredCustomThemes();
  const customTheme = customThemes.find((t) => t.id === preset);
  const styles = customTheme?.styles ?? getPresetThemeStyles(preset);

  return { mode, resolvedMode, preset, styles, customThemes };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ThemeState>(() => readInitialThemeState());

  useEffect(() => {
    if (state.mode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const newResolved = getSystemPreference();
      setState((prev) => ({ ...prev, resolvedMode: newResolved }));
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [state.mode]);

  useEffect(() => {
    applyDarkModeClass(state.resolvedMode === "dark");
    applyThemeStyles(state.styles[state.resolvedMode], state.preset === "default");
  }, [state.resolvedMode, state.styles, state.preset]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MODE_KEY, state.mode);
    localStorage.setItem(STORAGE_PRESET_KEY, state.preset);
    localStorage.setItem(STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(state.customThemes));

    if (state.preset !== "default") {
      const activeStyles = state.styles[state.resolvedMode];
      localStorage.setItem(STORAGE_ACTIVE_STYLES_KEY, JSON.stringify(activeStyles));
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_STYLES_KEY);
    }
  }, [state.mode, state.preset, state.customThemes, state.styles, state.resolvedMode]);

  const setMode = useCallback((mode: ThemeMode) => {
    const resolved = resolveMode(mode);
    setState((prev) => ({ ...prev, mode, resolvedMode: resolved }));
  }, []);

  const setPreset = useCallback((presetId: string) => {
    setState((prev) => {
      const customTheme = prev.customThemes.find((t) => t.id === presetId);
      const styles = customTheme?.styles ?? getPresetThemeStyles(presetId);
      return { ...prev, preset: presetId, styles };
    });
  }, []);

  const addCustomTheme = useCallback((name: string, styles: ThemeStyles): string => {
    const id = `custom-${Date.now()}`;
    const newTheme: CustomTheme = {
      id,
      name,
      createdAt: new Date().toISOString(),
      styles,
    };

    setState((prev) => ({ ...prev, customThemes: [...prev.customThemes, newTheme] }));
    return id;
  }, []);

  const updateCustomTheme = useCallback((id: string, name: string, styles: ThemeStyles) => {
    setState((prev) => {
      const customThemes = prev.customThemes.map((t) => (t.id === id ? { ...t, name, styles } : t));
      const nextStyles = prev.preset === id ? styles : prev.styles;
      return { ...prev, customThemes, styles: nextStyles };
    });
  }, []);

  const deleteCustomTheme = useCallback((id: string) => {
    setState((prev) => {
      const customThemes = prev.customThemes.filter((t) => t.id !== id);
      if (prev.preset === id) {
        return {
          ...prev,
          customThemes,
          preset: "default",
          styles: defaultThemeState.styles,
        };
      }

      return { ...prev, customThemes };
    });
  }, []);

  const importTweakCNTheme = useCallback((name: string, cssVariables: string): string => {
    const { light, dark } = parseCSSVariables(cssVariables);
    const styles: ThemeStyles = {
      light: { ...defaultThemeState.styles.light, ...light },
      dark: { ...defaultThemeState.styles.dark, ...dark },
    };

    return addCustomTheme(name, styles);
  }, [addCustomTheme]);

  const getAllThemes = useCallback(() => {
    const builtInThemes = [
      { id: "default", name: "Default", styles: defaultPreviewStyles, isCustom: false },
      ...Object.entries(presets)
        .filter(([id]) => id !== "default")
        .map(([id, preset]) => ({
          id,
          name: preset.label,
          styles: getPresetThemeStyles(id),
          isCustom: false,
        })),
    ];

    const customThemeList = state.customThemes.map((t) => ({
      id: t.id,
      name: t.name,
      styles: t.styles,
      isCustom: true,
    }));

    return [...builtInThemes, ...customThemeList];
  }, [state.customThemes]);

  const getCurrentThemeStyles = useCallback((): ThemeStyleProps => {
    return state.styles[state.resolvedMode];
  }, [state.styles, state.resolvedMode]);

  const value = useMemo(
    () => ({
      mode: state.mode,
      resolvedMode: state.resolvedMode,
      preset: state.preset,
      styles: state.styles,
      customThemes: state.customThemes,
      setMode,
      setPreset,
      addCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      importTweakCNTheme,
      getAllThemes,
      getCurrentThemeStyles,
    }),
    [
      state.mode,
      state.resolvedMode,
      state.preset,
      state.styles,
      state.customThemes,
      setMode,
      setPreset,
      addCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      importTweakCNTheme,
      getAllThemes,
      getCurrentThemeStyles,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
