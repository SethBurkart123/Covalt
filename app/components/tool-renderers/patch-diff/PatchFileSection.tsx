"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffView } from "../file-diff/DiffView";
import type { ParsedFilePatch } from "./parse-patch";

interface PatchFileSectionProps {
  file: ParsedFilePatch;
  defaultExpanded?: boolean;
}

const ACTION_LABEL: Record<ParsedFilePatch["action"], string> = {
  update: "Update",
  create: "Create",
  delete: "Delete",
};

export function PatchFileSection({
  file,
  defaultExpanded = true,
}: PatchFileSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = expanded ? ChevronDown : ChevronRight;

  return (
    <div data-testid="patch-file-section" data-file-path={file.path} className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3" />
        <span className="font-mono">{file.path}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", actionPillClass(file.action))}>
          {ACTION_LABEL[file.action]}
        </span>
      </button>
      {expanded && (
        <DiffView
          filePath={file.path}
          oldContent={file.oldContent}
          newContent={file.newContent}
          precomputedCounts={{ additions: file.additions, deletions: file.deletions }}
        />
      )}
    </div>
  );
}

function actionPillClass(action: ParsedFilePatch["action"]): string {
  if (action === "create") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (action === "delete") return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  return "bg-muted text-muted-foreground";
}
