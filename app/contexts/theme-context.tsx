"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme, x?: number, y?: number) => void;
};

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined);

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    // Check if we're in the browser
    if (typeof window !== "undefined") {
      // Check localStorage first
      const stored = localStorage.getItem("theme") as Theme | null;
      if (stored && (stored === "light" || stored === "dark" || stored === "system")) {
        return stored;
      }
    }
    return "system";
  });

  // Track resolved theme (the actual light/dark value being applied)
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(() => {
    if (theme === "system") {
      return getSystemPreference();
    }
    return theme;
  });

  const setTheme = React.useCallback((newTheme: Theme, x?: number, y?: number) => {
    // Skip transition if View Transitions API is not supported
    setThemeState(newTheme);
  }, []);

  // Resolve theme based on system preference when theme is "system"
  React.useEffect(() => {
    if (theme === "system") {
      const resolved = getSystemPreference();
      setResolvedTheme(resolved);
    } else {
      setResolvedTheme(theme);
    }
  }, [theme]);

  // Listen to system preference changes when theme is "system"
  React.useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setResolvedTheme(getSystemPreference());
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Fallback for older browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme]);

  // Update the class on the html element whenever resolved theme changes
  React.useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedTheme]);

  // Store theme preference in localStorage (store "system", not resolved value)
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", theme);
    }
  }, [theme]);

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}