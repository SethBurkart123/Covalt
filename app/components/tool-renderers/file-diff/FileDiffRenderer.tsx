"use client";

import { useCallback, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { ToolRendererProps } from "@/lib/renderers";
import { DiffView } from "./DiffView";
import { extractDiffInputs } from "./extract-diff-inputs";

export function FileDiffRenderer({ toolCall, config }: ToolRendererProps): ReactNode {
  const inputs = extractDiffInputs(config, toolCall.toolArgs);
  const handleCopyPath = useCallback(() => {
    if (!inputs.filePath) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(inputs.filePath);
  }, [inputs.filePath]);

  const label = inputs.isPartial && inputs.filePath ? `Edit applied: ${inputs.filePath}` : undefined;

  return (
    <Card data-testid="file-diff-tool" className="my-3 not-prose p-0">
      <DiffView
        filePath={inputs.filePath}
        label={label}
        oldContent={inputs.oldContent}
        newContent={inputs.newContent}
        onCopyPath={inputs.filePath ? handleCopyPath : undefined}
      />
    </Card>
  );
}

export default FileDiffRenderer;
