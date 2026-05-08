"use client";

import { useMemo, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ToolRendererProps } from "@/lib/renderers";
import { parseOpenAIPatch } from "./parse-patch";
import { PatchSummary } from "./PatchSummary";
import { PatchFileSection } from "./PatchFileSection";
import { extractPatchText } from "./extract-patch";

export function PatchDiffRenderer({ toolCall, config }: ToolRendererProps): ReactNode {
  const patchText = extractPatchText(config, toolCall);
  const files = useMemo(() => parseOpenAIPatch(patchText), [patchText]);

  if (files.length === 0) {
    return (
      <Card data-testid="patch-diff-tool" className="my-3 not-prose">
        <CardContent className="px-3 py-2 text-xs italic text-muted-foreground">
          (no patch to display)
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="patch-diff-tool" className="my-3 not-prose">
      <CardHeader className="pb-2">
        <PatchSummary files={files} />
      </CardHeader>
      <CardContent className="space-y-3">
        {files.map((file) => (
          <PatchFileSection key={`${file.action}:${file.path}`} file={file} />
        ))}
      </CardContent>
    </Card>
  );
}

export default PatchDiffRenderer;
