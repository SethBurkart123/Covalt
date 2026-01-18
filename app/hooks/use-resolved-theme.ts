"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/contexts/theme-context";

export function useResolvedTheme(): "light" | "dark" {
  const { theme } = useTheme();
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
  );

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemPreference(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return theme === "system" ? systemPreference : theme;
}
