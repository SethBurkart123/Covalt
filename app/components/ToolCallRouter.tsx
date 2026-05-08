"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getToolCallRenderer,
  preloadToolCallRenderer,
} from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import { ApprovalRouter } from "@/components/approvals/ApprovalRouter";
import { buildLegacyApprovalRequest } from "@/lib/services/approval-request-builder";
import { useResolveApproval } from "@/lib/services/use-resolve-approval";
import type { ToolCallRenderer, ToolCallRendererProps } from "@/lib/tool-renderers/types";

function PendingApprovalCall(props: ToolCallRendererProps) {
  const runId = props.runId ?? "";
  const requestId = props.requestId ?? props.toolCallId ?? props.id;
  const request = useMemo(
    () => buildLegacyApprovalRequest(props, runId),
    [props, runId],
  );
  const onResolve = useResolveApproval(runId, requestId);
  const toolCallTestId = `tool-call-${props.toolName}`;
  return (
    <div data-testid={toolCallTestId} data-toolcall>
      <ApprovalRouter request={request} isPending={true} onResolve={onResolve} />
    </div>
  );
}

export function ToolCallRouter(props: ToolCallRendererProps) {
  const [renderer, setRenderer] = useState<ToolCallRenderer | null>(null);
  const rendererKey = props.failed ? undefined : props.renderPlan?.renderer;

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);

    getToolCallRenderer(rendererKey)
      .then((component) => {
        if (!cancelled) {
          setRenderer(() => component);
        }
      })
      .catch((error) => {
        console.error("Failed to resolve tool renderer:", error);
        if (!cancelled) {
          setRenderer(() => DefaultToolCall);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rendererKey]);

  if (props.requiresApproval && props.approvalStatus === "pending") {
    return <PendingApprovalCall {...props} />;
  }

  const ResolvedRenderer = renderer || DefaultToolCall;
  return <ResolvedRenderer {...props} />;
}

export function preloadRenderersForToolCalls(
  renderers: Array<string | undefined>
): void {
  for (const renderer of renderers) {
    void preloadToolCallRenderer(renderer);
  }
}
