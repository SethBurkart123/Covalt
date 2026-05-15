import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/theme-context";
import {
  DIFF_THEME_OVERRIDES_EVENT,
  getDiffThemeOverrides,
  resolveDiffTheme,
  type DiffThemePair,
} from "@/lib/diff-theme-mapping";

export function useDiffTheme(): DiffThemePair {
  const { preset } = useTheme();
  const [overrides, setOverrides] = useState(getDiffThemeOverrides);

  useEffect(() => {
    const handler = () => setOverrides(getDiffThemeOverrides());
    window.addEventListener(DIFF_THEME_OVERRIDES_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(DIFF_THEME_OVERRIDES_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return resolveDiffTheme(preset, overrides);
}
