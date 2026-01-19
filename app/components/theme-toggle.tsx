"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";

export function ThemeToggle() {
  const { resolvedMode, setMode } = useTheme();

  return (
    <button
      onClick={() => {
        setMode(resolvedMode === "light" ? "dark" : "light");
      }}
      className="p-3 relative rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
