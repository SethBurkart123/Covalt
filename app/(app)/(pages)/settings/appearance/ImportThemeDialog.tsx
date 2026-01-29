"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/theme-context";
import { ExternalLink } from "lucide-react";

interface ImportThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportThemeDialog({ open, onOpenChange }: ImportThemeDialogProps) {
  const { importTweakCNTheme, setPreset } = useTheme();
  const [themeName, setThemeName] = useState("");
  const [cssVariables, setCssVariables] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setThemeName("");
    setCssVariables("");
    setError(null);
  };

  const handleImport = () => {
    if (!themeName.trim()) {
      setError("Please enter a theme name");
      return;
    }
    
    if (!cssVariables.trim()) {
      setError("Please paste your CSS variables");
      return;
    }

    if (!cssVariables.includes(":root") && !cssVariables.includes("--")) {
      setError("Invalid CSS variables. Make sure to copy the CSS from tweakcn.");
      return;
    }

    const themeId = importTweakCNTheme(themeName.trim(), cssVariables);
    setPreset(themeId);
    resetForm();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Theme from tweakcn</DialogTitle>
          <DialogDescription>
            Paste CSS variables from{" "}
            <a
              href="https://tweakcn.com/editor/theme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              tweakcn.com
              <ExternalLink className="w-3 h-3" />
            </a>
            {" "}to create a custom theme.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="theme-name">Theme Name</Label>
            <Input
              id="theme-name"
              placeholder="My Custom Theme"
              value={themeName}
              onChange={(e) => {
                setThemeName(e.target.value);
                setError(null);
              }}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="css-variables">CSS Variables</Label>
            <textarea
              id="css-variables"
              className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder={`:root {
  --background: #ffffff;
  --foreground: #333333;
  --primary: #3b82f6;
  /* ... more variables */
}

.dark {
  --background: #171717;
  --foreground: #e5e5e5;
  /* ... more variables */
}`}
              value={cssVariables}
              onChange={(e) => {
                setCssVariables(e.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Copy the CSS from tweakcn&apos;s &quot;Code&quot; button and paste it here.
            </p>
          </div>
          
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport}>
            Import Theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
