"use client";

import { useEffect, useState } from "react";

import {
  getToolCallRenderer,
  preloadToolCallRenderer,
} from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import type { ToolCallRenderer, ToolCallRendererProps } from "@/lib/tool-renderers/types";

export function ToolCallRouter(props: ToolCallRendererProps) {
  const [renderer, setRenderer] = useState<ToolCallRenderer | null>(null);
  const rendererKey = props.renderPlan?.renderer;

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
    return <DefaultToolCall {...props} />;
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
