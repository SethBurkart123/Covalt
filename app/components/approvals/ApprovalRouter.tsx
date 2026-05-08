"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getApprovalRenderer } from "@/lib/renderers";
import type { ApprovalRenderer, ApprovalRendererProps } from "@/lib/renderers";
import { DefaultApproval } from "./DefaultApproval";

export function ApprovalRouter(props: ApprovalRendererProps): ReactNode {
  const { request } = props;
  const [Resolved, setResolved] = useState<ApprovalRenderer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);

    const def = getApprovalRenderer(request.renderer, request.toolName);
    if (!def?.approval) return;

    def
      .approval()
      .then((mod) => {
        if (!cancelled) setResolved(() => mod.default);
      })
      .catch((error) => {
        console.error(
          `[ApprovalRouter] Failed to load approval renderer '${def.key}', falling back to default`,
          error,
        );
        if (!cancelled) setResolved(() => DefaultApproval);
      });

    return () => {
      cancelled = true;
    };
  }, [request.renderer, request.toolName]);

  const Component = Resolved ?? DefaultApproval;
  return <Component {...props} />;
}
