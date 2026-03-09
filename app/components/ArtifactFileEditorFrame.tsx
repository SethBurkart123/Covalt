"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Cloud,
  CloudOff,
  Loader2,
  Trash2,
} from "lucide-react";
import type { SaveStatus } from "@/hooks/use-artifact-file-editor-state";

interface ArtifactFileEditorFrameProps {
  filePath?: string;
  isDeleted: boolean;
  isDesynced: boolean;
  saveStatus: SaveStatus;
  errorMessage?: string | null;
  onDiscardChanges: () => void;
  topSlot?: ReactNode;
  children: ReactNode;
}

export function ArtifactFileEditorFrame({
  filePath,
  isDeleted,
  isDesynced,
  saveStatus,
  errorMessage,
  onDiscardChanges,
  topSlot,
  children,
}: ArtifactFileEditorFrameProps) {
  return (
    <div className="flex h-full flex-col">
      {isDeleted && <DeletedNotice />}
      {isDesynced && <DesyncedNotice onDiscardChanges={onDiscardChanges} />}
      {topSlot}
      {filePath && (
        <StatusBar
          filePath={filePath}
          isDeleted={isDeleted}
          isDesynced={isDesynced}
          saveStatus={saveStatus}
          errorMessage={errorMessage}
        />
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function DeletedNotice() {
  return (
    <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
      <div className="flex items-center gap-2">
        <Trash2 size={16} />
        <span>This file has been deleted from the workspace.</span>
      </div>
    </div>
  );
}

function DesyncedNotice({ onDiscardChanges }: { onDiscardChanges: () => void }) {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CloudOff size={16} />
          <span>File was modified externally. You have unsaved changes.</span>
        </div>
        <button
          onClick={onDiscardChanges}
          className="rounded bg-amber-500/20 px-2 py-1 text-xs transition-colors hover:bg-amber-500/30"
        >
          Discard my changes
        </button>
      </div>
    </div>
  );
}

interface StatusBarProps {
  filePath: string;
  isDeleted: boolean;
  isDesynced: boolean;
  saveStatus: SaveStatus;
  errorMessage?: string | null;
}

function StatusBar({
  filePath,
  isDeleted,
  isDesynced,
  saveStatus,
  errorMessage,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
      <span className="truncate font-mono text-muted-foreground">{filePath}</span>
      <div className="flex items-center gap-2">{renderStatus({ isDeleted, isDesynced, saveStatus, errorMessage })}</div>
    </div>
  );
}

function renderStatus({
  isDeleted,
  isDesynced,
  saveStatus,
  errorMessage,
}: Omit<StatusBarProps, "filePath">) {
  if (isDeleted) {
    return (
      <div className="flex items-center gap-1 text-red-500">
        <Trash2 size={14} />
        <span>Deleted</span>
      </div>
    );
  }

  if (isDesynced) {
    return (
      <div className="flex items-center gap-1 text-amber-500">
        <CloudOff size={14} />
        <span>Desynced</span>
      </div>
    );
  }

  if (saveStatus === "saving") {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        <span>Saving...</span>
      </div>
    );
  }

  if (saveStatus === "saved") {
    return (
      <div className="flex items-center gap-1 text-green-500">
        <Check size={14} />
        <span>Saved</span>
      </div>
    );
  }

  if (saveStatus === "error") {
    return (
      <div className="flex items-center gap-1 text-red-500" title={errorMessage || "Save failed"}>
        <AlertCircle size={14} />
        <span>Error</span>
      </div>
    );
  }

  if (saveStatus === "unsaved") {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <div className="h-2 w-2 rounded-full bg-amber-500" />
        <span>Unsaved</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <Cloud size={14} />
      <span>Synced</span>
    </div>
  );
}
