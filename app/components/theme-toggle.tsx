"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        // Use the center of the button as the origin point
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        setTheme(theme === "light" ? "dark" : "light", x, y);
      }}
      className="size-8"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
} 