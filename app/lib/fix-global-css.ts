import type { ThemeState } from "./types";

export function applyTheme(theme: ThemeState): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-theme", theme.currentMode);
  
  if (theme.styles) {
    Object.entries(theme.styles).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, String(value));
    });
  }
}
