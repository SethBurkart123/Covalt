"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  ApprovalEditable,
  ApprovalOption,
  ApprovalRendererProps,
  ApprovalRequest,
} from "@/lib/renderers";
import {
  RISK_LABELS,
  buildInitialEdits,
  buildOutcome,
  buttonVariantFor,
  isInputValid,
  pathKey,
  type AnswerMap,
  type EditMap,
} from "@/components/approvals/approval-logic";
import { DiffView } from "./DiffView";
import { extractDiffInputs } from "./extract-diff-inputs";

const NEW_CONTENT_PATH_KEYS = new Set(["new_str", "newStr", "new_content", "newContent", "replace"]);

function findEditableNewContent(editable: ApprovalEditable[]): ApprovalEditable | undefined {
  return editable.find((field) => {
    if (field.path.length !== 1) return false;
    return NEW_CONTENT_PATH_KEYS.has(field.path[0]);
  });
}

function RiskPill({ level }: { level: ApprovalRequest["riskLevel"] }): ReactNode {
  if (!level || level === "unknown") return null;
  const label = RISK_LABELS[level] ?? level;
  const cls =
    level === "high"
      ? "bg-destructive/10 text-destructive"
      : level === "medium"
        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      data-testid="approval-risk-pill"
      data-risk-level={level}
      className={cn("text-xs px-2 py-0.5 rounded font-medium", cls)}
    >
      {label}
    </span>
  );
}

export function FileDiffApproval({
  request,
  isPending,
  onResolve,
}: ApprovalRendererProps): ReactNode {
  const toolArgs = request.config?.toolArgs as Record<string, unknown> | undefined;
  const inputs = extractDiffInputs(request.config, toolArgs);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [edits, setEdits] = useState<EditMap>(() => buildInitialEdits(request));
  const [submitting, setSubmitting] = useState(false);

  const editableNewContent = useMemo(
    () => findEditableNewContent(request.editable),
    [request.editable],
  );

  const editedNewContent = editableNewContent
    ? (edits[pathKey(editableNewContent.path)] as string | undefined)
    : undefined;
  const previewNewContent = editedNewContent ?? inputs.newContent;

  const inputValid = useMemo(
    () => isInputValid(request, answers, edits),
    [request, answers, edits],
  );

  const handleSelect = useCallback(
    async (option: ApprovalOption) => {
      if (submitting || !isPending) return;
      setSubmitting(true);
      try {
        await onResolve(buildOutcome(request, option, answers, edits));
      } catch (error) {
        console.error("[FileDiffApproval] onResolve failed", error);
        setSubmitting(false);
      }
    },
    [submitting, isPending, onResolve, request, answers, edits],
  );

  const disabled = submitting || !isPending;
  const headerTitle = inputs.filePath ? `Edit file: ${inputs.filePath}` : "Edit file";
  const partialLabel = inputs.isPartial && inputs.filePath
    ? `Edit applied: ${inputs.filePath}`
    : undefined;

  return (
    <Card data-testid="file-diff-approval" className="my-3 not-prose">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{headerTitle}</div>
          {request.summary && (
            <div className="text-xs text-muted-foreground">{request.summary}</div>
          )}
        </div>
        <RiskPill level={request.riskLevel} />
      </CardHeader>

      <CardContent className="space-y-4">
        <DiffView
          filePath={inputs.filePath}
          label={partialLabel}
          oldContent={inputs.oldContent}
          newContent={previewNewContent}
        />

        {editableNewContent && (
          <div className="space-y-2" data-testid="file-diff-editable">
            <Label htmlFor="file-diff-new-content">
              {editableNewContent.label ?? "New content"}
            </Label>
            <Textarea
              id="file-diff-new-content"
              value={(editedNewContent as string | undefined) ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, [pathKey(editableNewContent.path)]: e.target.value }))
              }
            />
          </div>
        )}

        {request.questions.length > 0 && (
          <div className="space-y-3" data-testid="approval-questions">
            {request.questions.map((q) => (
              <div key={q.index} className="space-y-2">
                <Label htmlFor={`fd-q-${q.index}`}>
                  {q.required ? `${q.question} *` : q.question}
                </Label>
                <Textarea
                  id={`fd-q-${q.index}`}
                  value={answers[q.index] ?? ""}
                  placeholder={q.placeholder}
                  disabled={disabled}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.index]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-end gap-2 pt-3">
        {request.options.map((option) => {
          const blockedByInput = Boolean(option.requiresInput) && !inputValid;
          return (
            <Button
              key={option.value}
              data-testid={`approval-option-${option.value}`}
              data-role={option.role}
              variant={buttonVariantFor(option)}
              disabled={disabled || blockedByInput}
              loading={submitting}
              onClick={() => handleSelect(option)}
            >
              {option.label}
            </Button>
          );
        })}
      </CardFooter>
    </Card>
  );
}

export default FileDiffApproval;
