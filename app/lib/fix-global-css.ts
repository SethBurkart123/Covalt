import type { ThemeState } from "./types";

export function applyTheme(theme: ThemeState): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  
  // Set theme mode as data attribute for CSS selectors
  root.setAttribute("data-theme", theme.currentMode);
  
  // Apply each style property as a CSS custom property
  if (theme.styles) {
    Object.entries(theme.styles).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, String(value));
    });
  }
}
