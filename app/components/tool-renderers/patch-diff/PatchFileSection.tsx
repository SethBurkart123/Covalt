import { type ReactNode } from "react";
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
}: PatchFileSectionProps): ReactNode {
  return (
    <div
      data-testid="patch-file-section"
      data-file-path={file.path}
      className="relative"
    >
      <div className="absolute right-2 top-2 z-10">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            actionPillClass(file.action),
          )}
        >
          {ACTION_LABEL[file.action]}
        </span>
      </div>
      <DiffView
        filePath={file.path}
        oldContent={file.oldContent}
        newContent={file.newContent}
        precomputedCounts={{ additions: file.additions, deletions: file.deletions }}
        disableCollapsibleChrome
      />
    </div>
  );
}

function actionPillClass(action: ParsedFilePatch["action"]): string {
  if (action === "create") return "bg-success/10 text-success";
  if (action === "delete") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}
