"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileStack } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import type { ToolCallPayload } from "@/lib/types/chat";
import { DiffStats } from "../file-diff/DiffView";
import { parseOpenAIPatch } from "./parse-patch";
import { PatchFileSection } from "./PatchFileSection";
import { extractPatchText } from "./extract-patch";

export function PatchDiffRenderer({
  toolArgs,
  toolResult,
  renderPlan,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps): ReactNode {
  const patchText = useMemo(
    () => extractPatchText(renderPlan?.config, {
      id: "",
      toolName: "",
      toolArgs,
      toolResult,
    } satisfies ToolCallPayload),
    [renderPlan?.config, toolArgs, toolResult],
  );
  const files = useMemo(() => parseOpenAIPatch(patchText), [patchText]);
  const counts = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    return { additions, deletions };
  }, [files]);
  const headerLabel = useMemo(() => {
    if (files.length === 0) return "apply_patch";
    const word = files.length === 1 ? "file" : "files";
    return `${files.length} ${word}`;
  }, [files.length]);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      mode={mode}
      data-testid="patch-diff-tool"
      data-toolcall
    >
      <CollapsibleTrigger
        rightContent={
          <DiffStats additions={counts.additions} deletions={counts.deletions} />
        }
      >
        <CollapsibleHeader>
          <CollapsibleIcon icon={FileStack} />
          <span className="text-sm font-mono text-foreground truncate min-w-0">
            {headerLabel}
          </span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {files.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">
            (no patch to display)
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <PatchFileSection key={`${file.action}:${file.path}`} file={file} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default PatchDiffRenderer;
