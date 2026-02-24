"use client";

import { Monitor, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { FrameArtifactContent } from "./FrameArtifactContent";

function buildUrl(urlValue: unknown, portValue: unknown): string {
  if (typeof urlValue === "string" && urlValue.trim()) {
    return urlValue.trim();
  }
  if (typeof portValue === "number" && Number.isFinite(portValue)) {
    return `http://localhost:${portValue}`;
  }
  if (typeof portValue === "string" && portValue.trim()) {
    const parsed = Number(portValue);
    if (Number.isFinite(parsed)) {
      return `http://localhost:${parsed}`;
    }
  }
  return "";
}

export function FrameArtifact({
  toolName,
  toolArgs,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  renderPlan,
}: ToolCallRendererProps) {
  const { open } = useArtifactPanel();

  const title = (toolArgs.title as string) || toolName;
  const url = buildUrl(renderPlan?.config?.url, renderPlan?.config?.port);

  const handleClick = () => {
    if (!isCompleted || !url) return;
    open(
      toolCallId || `${toolName}-${title}`,
      title,
      <FrameArtifactContent url={url} title={title} />
    );
  };

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted}
      disableToggle
      data-toolcall
    >
      <CollapsibleTrigger onClick={handleClick}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Monitor} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {!isCompleted && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
