"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Editor from "@monaco-editor/react";
import { debounce } from "lodash";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { Loader2, Check, AlertCircle, Cloud, CloudOff, Trash2 } from "lucide-react";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface EditableCodeViewerProps {
  language: string;
  filePath: string;
}

export function EditableCodeViewer({
  language,
  filePath,
}: EditableCodeViewerProps) {
  const resolvedTheme = useResolvedTheme();
  const { getFileState, saveFile } = useArtifactPanel();

  const fileState = getFileState(filePath);
  const syncedContent = fileState?.content ?? "";
  const isLoading = fileState?.isLoading ?? true;
  const isDeleted = fileState?.isDeleted ?? false;
  const version = fileState?.version ?? 0;

  const [localContent, setLocalContent] = useState<string | null>(null);
  const [lastSyncedVersion, setLastSyncedVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const isSavingRef = useRef(false);

  const editorContent = localContent ?? syncedContent;

  const hasUnsavedChanges = localContent !== null;
  const externallyChanged = version > lastSyncedVersion;
  const isDesynced = externallyChanged && hasUnsavedChanges && !isSavingRef.current;

  useEffect(() => {
    if (externallyChanged && !hasUnsavedChanges && !isSavingRef.current) {
      setLastSyncedVersion(version);
    }
  }, [version, externallyChanged, hasUnsavedChanges]);

  useEffect(() => {
    if (!isLoading && lastSyncedVersion === 0 && version > 0) {
      setLastSyncedVersion(version);
    }
  }, [isLoading, lastSyncedVersion, version]);

  const debouncedSave = useMemo(
    () =>
      debounce(async (newContent: string, path: string) => {
        if (isDeleted) return;

        isSavingRef.current = true;
        setSaveStatus("saving");
        setErrorMessage(null);

        try {
          await saveFile(path, newContent);
          setLocalContent(null);
          setLastSyncedVersion((v) => v + 1);
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
        } finally {
          isSavingRef.current = false;
        }
      }, 1000),
    [saveFile, isDeleted]
  );

  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if ((value ?? "") === syncedContent) {
        setLocalContent(null);
        setSaveStatus("idle");
        debouncedSave.cancel();
      } else {
        setLocalContent(value ?? "");
        setSaveStatus("unsaved");
        debouncedSave(value ?? "", filePath);
      }
    },
    [filePath, syncedContent, debouncedSave]
  );

  const forceSave = useCallback(async () => {
    if (isDeleted || !hasUnsavedChanges || !localContent) return;

    debouncedSave.cancel();
    isSavingRef.current = true;
    setSaveStatus("saving");
    setErrorMessage(null);

    try {
      await saveFile(filePath, localContent);
      setLocalContent(null);
      setLastSyncedVersion((v) => v + 1);
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
    } finally {
      isSavingRef.current = false;
    }
  }, [localContent, filePath, isDeleted, hasUnsavedChanges, debouncedSave, saveFile]);

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

  const acceptExternalChanges = useCallback(() => {
    setLocalContent(null);
    setLastSyncedVersion(version);
    setSaveStatus("idle");
    debouncedSave.cancel();
  }, [version, debouncedSave]);

  if (isLoading && !syncedContent) {
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

      {isDesynced && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CloudOff size={16} />
              <span>File was modified externally. You have unsaved changes.</span>
            </div>
            <button
              onClick={acceptExternalChanges}
              className="px-2 py-1 text-xs bg-amber-500/20 hover:bg-amber-500/30 rounded transition-colors"
            >
              Discard my changes
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30 text-xs">
        <span className="text-muted-foreground font-mono truncate">
          {filePath}
        </span>
        <div className="flex items-center gap-2">
          {!isDeleted && !isDesynced && saveStatus === "idle" && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Cloud size={14} />
              <span>Synced</span>
            </div>
          )}
          {!isDeleted && !isDesynced && saveStatus === "unsaved" && (
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
          {!isDeleted && !isDesynced && saveStatus === "saved" && (
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
          {isDesynced && (
            <div className="flex items-center gap-1 text-amber-500">
              <CloudOff size={14} />
              <span>Desynced</span>
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
          value={editorContent}
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
