
import { useMemo, type ReactNode } from "react";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";
import type { ApprovalRendererProps } from "@/lib/renderers";
import { parseOpenAIPatch } from "./parse-patch";
import { PatchFileSection } from "./PatchFileSection";
import { extractPatchText } from "./extract-patch";

export function PatchDiffApproval(props: ApprovalRendererProps): ReactNode {
  const { request } = props;
  const patchText = useMemo(
    () => extractPatchText(request.config, undefined),
    [request.config],
  );
  const files = useMemo(() => parseOpenAIPatch(patchText), [patchText]);

  return (
    <DefaultApproval
      {...props}
      hideArguments
      fallbackToolName={request.toolName ?? "apply_patch"}
      renderBody={() => (
        <div data-testid="patch-diff-approval-body" className="space-y-1">
          {files.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">
              (no patch to display)
            </div>
          ) : (
            files.map((file) => (
              <PatchFileSection key={`${file.action}:${file.path}`} file={file} />
            ))
          )}
        </div>
      )}
    />
  );
}

export default PatchDiffApproval;
