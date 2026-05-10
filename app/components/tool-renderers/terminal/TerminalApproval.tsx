"use client";

import { type ReactNode } from "react";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";
import type { ApprovalRendererProps, ApprovalRequest } from "@/lib/renderers";

function readCwd(request: ApprovalRequest): string | undefined {
  const args = request.config?.toolArgs as Record<string, unknown> | undefined;
  if (!args) return undefined;
  return typeof args.cwd === "string" ? args.cwd : undefined;
}

export function TerminalApproval(props: ApprovalRendererProps): ReactNode {
  const cwd = readCwd(props.request);

  return (
    <DefaultApproval
      {...props}
      fallbackToolName={props.request.toolName ?? "execute"}
      renderBody={() =>
        cwd ? (
          <div
            data-testid="terminal-approval-cwd"
            className="text-xs text-muted-foreground font-mono pb-1"
          >
            cwd: {cwd}
          </div>
        ) : null
      }
    />
  );
}

export default TerminalApproval;
