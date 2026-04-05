"use client";

import { debounce } from "lodash";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface UseArtifactFileEditorStateOptions {
  filePath?: string;
  content?: string;
  readOnly?: boolean;
  autoSaveDelayMs?: number;
}

interface UseArtifactFileEditorStateResult {
  currentContent: string;
  syncedContent: string;
  isLoading: boolean;
  isDeleted: boolean;
  effectiveReadOnly: boolean;
  saveStatus: SaveStatus;
  errorMessage: string | null;
  isDesynced: boolean;
  hasUnsavedChanges: boolean;
  updateContent: (nextContent: string) => void;
  forceSave: () => Promise<void>;
  acceptExternalChanges: () => void;
}

export function useArtifactFileEditorState({
  filePath,
  content,
  readOnly = false,
  autoSaveDelayMs = 1000,
}: UseArtifactFileEditorStateOptions): UseArtifactFileEditorStateResult {
  const { getFileState, saveFile } = useArtifactPanel();
  const isContentMode = !filePath && content !== undefined;
  const fileState = filePath ? getFileState(filePath) : undefined;
  const syncedContent = isContentMode ? content : (fileState?.content ?? "");
  const isLoading = isContentMode ? false : (fileState?.isLoading ?? true);
  const isDeleted = isContentMode ? false : (fileState?.isDeleted ?? false);
  const version = isContentMode ? 0 : (fileState?.version ?? 0);
  const effectiveReadOnly = readOnly || isContentMode;

  const [localContent, setLocalContent] = useState<string | null>(null);
  const [lastSyncedVersion, setLastSyncedVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSavingRef = useRef(false);
  const hasUnsavedChanges = localContent !== null;
  const externallyChanged = version > lastSyncedVersion;
  const isDesynced = externallyChanged && hasUnsavedChanges && !isSavingRef.current;
  const currentContent = localContent ?? syncedContent;

  if (externallyChanged && !hasUnsavedChanges && !isSavingRef.current) {
    setLastSyncedVersion(version);
  }

  if (!isLoading && lastSyncedVersion === 0 && version > 0) {
    setLastSyncedVersion(version);
  }

  const persistContent = useCallback(
    async (nextContent: string, path: string) => {
      if (isDeleted) return;

      isSavingRef.current = true;
      setSaveStatus("saving");
      setErrorMessage(null);

      try {
        await saveFile(path, nextContent);
        setLocalContent(null);
        setLastSyncedVersion((currentVersion) => currentVersion + 1);
        setSaveStatus("saved");
        window.setTimeout(() => {
          setSaveStatus((currentStatus) => currentStatus === "saved" ? "idle" : currentStatus);
        }, 2000);
      } catch (error) {
        console.error("Failed to save file:", error);
        setSaveStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to save");
      } finally {
        isSavingRef.current = false;
      }
    },
    [isDeleted, saveFile]
  );

  const debouncedSave = useMemo(
    () => debounce((nextContent: string, path: string) => void persistContent(nextContent, path), autoSaveDelayMs),
    [autoSaveDelayMs, persistContent]
  );

  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  const updateContent = useCallback(
    (nextContent: string) => {
      if (effectiveReadOnly || !filePath) return;

      if (nextContent === syncedContent) {
        setLocalContent(null);
        setSaveStatus("idle");
        debouncedSave.cancel();
        return;
      }

      setLocalContent(nextContent);
      setSaveStatus("unsaved");
      debouncedSave(nextContent, filePath);
    },
    [debouncedSave, effectiveReadOnly, filePath, syncedContent]
  );

  const forceSave = useCallback(async () => {
    if (isDeleted || localContent === null || !filePath) return;

    debouncedSave.cancel();
    await persistContent(localContent, filePath);
  }, [debouncedSave, filePath, isDeleted, localContent, persistContent]);

  useEffect(() => {
    if (effectiveReadOnly || !filePath) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void forceSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectiveReadOnly, filePath, forceSave]);

  const acceptExternalChanges = useCallback(() => {
    setLocalContent(null);
    setLastSyncedVersion(version);
    setSaveStatus("idle");
    debouncedSave.cancel();
  }, [debouncedSave, version]);

  return {
    currentContent,
    syncedContent,
    isLoading,
    isDeleted,
    effectiveReadOnly,
    saveStatus,
    errorMessage,
    isDesynced,
    hasUnsavedChanges,
    updateContent,
    forceSave,
    acceptExternalChanges,
  };
}
