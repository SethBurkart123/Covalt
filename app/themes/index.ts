import type { ThemeStyleProps } from "@/lib/types";

export interface ThemeFile {
  id: string;
  name: string;
  createdAt?: string;
  styles: {
    light: ThemeStyleProps;
    dark?: ThemeStyleProps;
  };
}

import defaultTheme from "./default.json";
import modernMinimal from "./modern-minimal.json";
import perpetuity from "./perpetuity.json";
import cosmicNight from "./cosmic-night.json";
import tangerine from "./tangerine.json";
import quantumRose from "./quantum-rose.json";
import nature from "./nature.json";
import boldTech from "./bold-tech.json";
import elegantLuxury from "./elegant-luxury.json";
import claude from "./claude.json";
import vercel from "./vercel.json";

export const themes: Record<string, ThemeFile> = {
  default: defaultTheme,
  "modern-minimal": modernMinimal,
  perpetuity,
  "cosmic-night": cosmicNight,
  tangerine,
  "quantum-rose": quantumRose,
  nature,
  "bold-tech": boldTech,
  "elegant-luxury": elegantLuxury,
  claude,
  vercel,
} satisfies Record<string, ThemeFile>;

export function getAvailableThemes() {
  return Object.entries(themes).map(([id, theme]) => ({ id, name: theme.name }));
}
