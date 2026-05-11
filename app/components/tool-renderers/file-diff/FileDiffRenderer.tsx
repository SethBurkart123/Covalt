"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileCode2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { DiffView, DiffStats, countDiffLines } from "./DiffView";
import { extractDiffInputs } from "./extract-diff-inputs";

export function FileDiffRenderer({
  toolArgs,
  renderPlan,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps): ReactNode {
  const inputs = useMemo(
    () => extractDiffInputs(renderPlan?.config, toolArgs),
    [renderPlan?.config, toolArgs],
  );
  const counts = useMemo(
    () => countDiffLines(inputs.oldContent, inputs.newContent),
    [inputs.oldContent, inputs.newContent],
  );
  const headerLabel =
    inputs.isPartial && inputs.filePath
      ? `Edit applied: ${inputs.filePath}`
      : inputs.filePath ?? "Edit";

  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      mode={mode}
      data-testid="file-diff-tool"
      data-toolcall
    >
      <CollapsibleTrigger
        rightContent={
          <DiffStats additions={counts.additions} deletions={counts.deletions} />
        }
      >
        <CollapsibleHeader>
          <CollapsibleIcon icon={FileCode2} />
          <span className="text-sm font-mono text-foreground truncate min-w-0">
            {headerLabel}
          </span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent className="p-0 space-y-0">
        <DiffView
          filePath={inputs.filePath}
          oldContent={inputs.oldContent}
          newContent={inputs.newContent}
          precomputedCounts={counts}
          headless
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export default FileDiffRenderer;
