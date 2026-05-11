"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getToolCallRenderer,
  getToolCallRendererDisplay,
  preloadToolCallRenderer,
} from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import { ApprovalRouter } from "@/components/approvals/ApprovalRouter";
import { buildLegacyApprovalRequest } from "@/lib/services/approval-request-builder";
import { useResolveToolDecision } from "@/lib/services/use-resolve-tool-decision";
import type { ToolCallRenderer, ToolCallRendererProps } from "@/lib/tool-renderers/types";

function PendingApprovalCall(props: ToolCallRendererProps) {
  const runId = props.runId ?? "";
  const toolCallId = props.toolCallId ?? props.id;
  const request = useMemo(
    () => buildLegacyApprovalRequest(props, runId),
    [props, runId],
  );
  const onResolve = useResolveToolDecision(runId, toolCallId);
  return (
    <ApprovalRouter
      request={request}
      isPending
      onResolve={onResolve}
      isGrouped={props.isGrouped}
      isFirst={props.isFirst}
      isLast={props.isLast}
      mode={props.mode}
    />
  );
}

export function ToolCallRouter(props: ToolCallRendererProps) {
  const [renderer, setRenderer] = useState<ToolCallRenderer | null>(null);
  const isPending = Boolean(
    props.requiresApproval && props.approvalStatus === "pending",
  );
  const rendererKey = props.failed ? undefined : props.renderPlan?.renderer;

  useEffect(() => {
    let cancelled = false;
    setRenderer(null);

    getToolCallRenderer(rendererKey, props.toolName)
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
  }, [rendererKey, props.toolName]);

  if (isPending) return <PendingApprovalCall {...props} />;

  const ResolvedRenderer = renderer || DefaultToolCall;
  return (
    <ResolvedRenderer
      {...props}
      display={getToolCallRendererDisplay(rendererKey, props.toolName)}
    />
  );
}

export function preloadRenderersForToolCalls(
  renderers: Array<string | undefined | { renderer?: string; toolName?: string }>
): void {
  for (const renderer of renderers) {
    if (typeof renderer === "object") {
      void preloadToolCallRenderer(renderer.renderer, renderer.toolName);
    } else {
      void preloadToolCallRenderer(renderer);
    }
  }
}
