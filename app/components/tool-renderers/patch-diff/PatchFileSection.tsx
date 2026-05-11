"use client";

import { useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      mode="minimal"
      data-testid="patch-file-section"
      data-file-path={file.path}
    >
      <CollapsibleTrigger
        rightContent={
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              actionPillClass(file.action),
            )}
          >
            {ACTION_LABEL[file.action]}
          </span>
        }
      >
        <span className="font-mono">{file.path}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-0 pt-2 pb-2">
        <DiffView
          filePath={file.path}
          oldContent={file.oldContent}
          newContent={file.newContent}
          precomputedCounts={{ additions: file.additions, deletions: file.deletions }}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function actionPillClass(action: ParsedFilePatch["action"]): string {
  if (action === "create") return "bg-success/10 text-success";
  if (action === "delete") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}
