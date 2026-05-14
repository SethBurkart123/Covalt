
import { useMemo, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";
import type {
  ApprovalEditable,
  ApprovalRendererProps,
} from "@/lib/renderers";
import { DiffView } from "./DiffView";
import { extractDiffInputs } from "./extract-diff-inputs";

const NEW_CONTENT_PATH_KEYS = new Set(["new_str", "newStr", "new_content", "newContent", "replace"]);

function findEditableNewContent(editable: ApprovalEditable[]): ApprovalEditable | undefined {
  return editable.find((field) => {
    if (field.path.length !== 1) return false;
    return NEW_CONTENT_PATH_KEYS.has(field.path[0]);
  });
}

export function FileDiffApproval(props: ApprovalRendererProps): ReactNode {
  const { request } = props;
  const toolArgs = request.config?.toolArgs as Record<string, unknown> | undefined;
  const inputs = useMemo(
    () => extractDiffInputs(request.config, toolArgs),
    [request.config, toolArgs],
  );
  const editableNewContent = useMemo(
    () => findEditableNewContent(request.editable),
    [request.editable],
  );

  return (
    <DefaultApproval
      {...props}
      hideArguments
      fallbackToolName={request.toolName ?? "edit"}
      renderBody={({ edits, setEdit, disabled }) => {
        const key = editableNewContent ? editableNewContent.path[0] : undefined;
        const editedNewContent = key ? (edits[key] as string | undefined) : undefined;
        const previewNewContent = editedNewContent ?? inputs.newContent;
        const partialLabel = inputs.isPartial && inputs.filePath
          ? `Edit applied: ${inputs.filePath}`
          : undefined;
        return (
          <div data-testid="file-diff-approval-body" className="space-y-3">
            <DiffView
              filePath={inputs.filePath}
              label={partialLabel}
              oldContent={inputs.oldContent}
              newContent={previewNewContent}
            />
            {editableNewContent && key && (
              <div className="space-y-2" data-testid="file-diff-editable">
                <Label htmlFor="file-diff-new-content">
                  {editableNewContent.label ?? "New content"}
                </Label>
                <Textarea
                  id="file-diff-new-content"
                  data-testid="file-diff-new-content"
                  value={(editedNewContent ?? inputs.newContent) as string}
                  disabled={disabled}
                  onChange={(e) => setEdit(key, e.target.value)}
                />
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

export default FileDiffApproval;
