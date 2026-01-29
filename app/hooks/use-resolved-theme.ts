"use client";

import { useTheme } from "@/contexts/theme-context";

export function useResolvedTheme(): "light" | "dark" {
  return useTheme().resolvedMode;
}
