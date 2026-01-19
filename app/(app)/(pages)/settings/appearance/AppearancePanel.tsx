"use client";

import { useState, useMemo, useCallback } from "react";
import { useTheme, type ThemeMode } from "@/contexts/theme-context";
import { ThemeCard } from "./ThemeCard";
import { ImportThemeDialog } from "./ImportThemeDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sun, Moon, Monitor, Download, Search, Palette, Plus } from "lucide-react";

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function toThemeMode(value: string): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function AppearancePanel() {
  const {
    mode,
    setMode,
    preset,
    setPreset,
    resolvedMode,
    getAllThemes,
    deleteCustomTheme,
  } = useTheme();

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const allThemes = useMemo(() => getAllThemes(), [getAllThemes]);

  const filteredThemes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allThemes;
    return allThemes.filter((theme) => theme.name.toLowerCase().includes(query));
  }, [allThemes, searchQuery]);

  const { builtInThemes, customThemes } = useMemo(() => {
    return {
      builtInThemes: filteredThemes.filter((t) => !t.isCustom),
      customThemes: filteredThemes.filter((t) => t.isCustom),
    };
  }, [filteredThemes]);

  const handleDeleteTheme = useCallback(
    (themeId: string) => {
      if (confirm("Are you sure you want to delete this theme?")) deleteCustomTheme(themeId);
    },
    [deleteCustomTheme]
  );

  const query = searchQuery.trim();

  return (
    <div className="space-y-8 py-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Appearance Mode</h2>
          <p className="text-sm text-muted-foreground">
            Choose how the app looks. Select a mode or let it follow your system settings.
          </p>
        </div>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(toThemeMode(value))}
          className="grid grid-cols-3 gap-4"
        >
          {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <div key={value}>
              <RadioGroupItem
                value={value}
                id={`mode-${value}`}
                className="peer sr-only"
              />
              <Label
                htmlFor={`mode-${value}`}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-colors"
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{label}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Color Theme</h2>
            <p className="text-sm text-muted-foreground">
              Choose a color theme for your interface.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Import from tweakcn
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search themes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {builtInThemes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Built-in Themes</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {builtInThemes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  id={theme.id}
                  name={theme.name}
                  lightStyles={theme.styles.light}
                  darkStyles={theme.styles.dark}
                  isSelected={preset === theme.id}
                  isCustom={false}
                  previewMode={resolvedMode}
                  onSelect={() => setPreset(theme.id)}
                />
              ))}
            </div>
          </div>
        )}

        {!query && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Custom Themes</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {customThemes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  id={theme.id}
                  name={theme.name}
                  lightStyles={theme.styles.light}
                  darkStyles={theme.styles.dark}
                  isSelected={preset === theme.id}
                  isCustom={true}
                  previewMode={resolvedMode}
                  onSelect={() => setPreset(theme.id)}
                  onDelete={() => handleDeleteTheme(theme.id)}
                />
              ))}
              <button
                onClick={() => setImportDialogOpen(true)}
                className="aspect-[4/3] rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-8 h-8" />
                <span className="text-sm font-medium">Add Theme</span>
              </button>
            </div>
          </div>
        )}

        {query && customThemes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Custom Themes</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {customThemes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  id={theme.id}
                  name={theme.name}
                  lightStyles={theme.styles.light}
                  darkStyles={theme.styles.dark}
                  isSelected={preset === theme.id}
                  isCustom={true}
                  previewMode={resolvedMode}
                  onSelect={() => setPreset(theme.id)}
                  onDelete={() => handleDeleteTheme(theme.id)}
                />
              ))}
            </div>
          </div>
        )}

        {filteredThemes.length === 0 && query && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Palette className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No themes found matching &quot;{query}&quot;</p>
          </div>
        )}
      </section>

      <ImportThemeDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
    </div>
  );
}
