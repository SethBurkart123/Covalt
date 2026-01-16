"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { debounce } from "lodash";
import { useTheme } from "@/contexts/theme-context";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { Loader2, Check, AlertCircle, Cloud, Trash2 } from "lucide-react";

// Configure Monaco to load from CDN
loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
  },
});

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface EditableCodeViewerProps {
  language: string;
  filePath: string;
  chatId: string;
}

function useResolvedTheme(): "light" | "dark" {
  const { theme } = useTheme();
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
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

export function EditableCodeViewer({
  language,
  filePath,
}: EditableCodeViewerProps) {
  const resolvedTheme = useResolvedTheme();
  const { getFileState, saveFile } = useArtifactPanel();

  // Get file state from context
  const fileState = getFileState(filePath);
  const content = fileState?.content ?? "";
  const isLoading = fileState?.isLoading ?? false;
  const isDeleted = fileState?.isDeleted ?? false;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce(async (newContent: string, path: string) => {
        if (isDeleted) {
          return;
        }

        setSaveStatus("saving");
        setErrorMessage(null);

        try {
          await saveFile(path, newContent);
          setSaveStatus("saved");

          setTimeout(() => {
            setSaveStatus((current) => (current === "saved" ? "idle" : current));
          }, 2000);
        } catch (error) {
          console.error("Failed to save file:", error);
          setSaveStatus("error");
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to save"
          );
        }
      }, 1000),
    [saveFile, isDeleted]
  );

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? "";
      setSaveStatus("unsaved");
      debouncedSave(newContent, filePath);
    },
    [filePath, debouncedSave]
  );

  const forceSave = useCallback(async () => {
    if (isDeleted) return;

    debouncedSave.cancel();

    setSaveStatus("saving");
    setErrorMessage(null);

    try {
      await saveFile(filePath, content);
      setSaveStatus("saved");

      setTimeout(() => {
        setSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, 2000);
    } catch (error) {
      console.error("Failed to save file:", error);
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save"
      );
    }
  }, [content, filePath, isDeleted, debouncedSave, saveFile]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        forceSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [forceSave]);

  if (isLoading && !content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading file...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {isDeleted && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 text-sm text-red-600 dark:text-red-400">
          <div className="flex items-center gap-2">
            <Trash2 size={16} />
            <span>This file has been deleted from the workspace.</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30 text-xs">
        <span className="text-muted-foreground font-mono truncate">
          {filePath}
        </span>
        <div className="flex items-center gap-2">
          {!isDeleted && saveStatus === "idle" && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Cloud size={14} />
              <span>Synced</span>
            </div>
          )}
          {!isDeleted && saveStatus === "unsaved" && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Unsaved</span>
            </div>
          )}
          {!isDeleted && saveStatus === "saving" && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span>Saving...</span>
            </div>
          )}
          {!isDeleted && saveStatus === "saved" && (
            <div className="flex items-center gap-1 text-green-500">
              <Check size={14} />
              <span>Saved</span>
            </div>
          )}
          {!isDeleted && saveStatus === "error" && (
            <div
              className="flex items-center gap-1 text-red-500"
              title={errorMessage || "Save failed"}
            >
              <AlertCircle size={14} />
              <span>Error</span>
            </div>
          )}
          {isDeleted && (
            <div className="flex items-center gap-1 text-red-500">
              <Trash2 size={14} />
              <span>Deleted</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={handleChange}
          theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
            readOnly: isDeleted,
            padding: { top: 8 },
          }}
          loading={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading editor...
            </div>
          }
        />
      </div>
    </div>
  );
}
