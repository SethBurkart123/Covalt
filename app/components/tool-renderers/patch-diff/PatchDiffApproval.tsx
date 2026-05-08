"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
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
  type AnswerMap,
  type EditMap,
} from "@/components/approvals/approval-logic";
import { parseOpenAIPatch } from "./parse-patch";
import { PatchSummary } from "./PatchSummary";
import { PatchFileSection } from "./PatchFileSection";
import { extractPatchText } from "./extract-patch";

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

export function PatchDiffApproval({
  request,
  isPending,
  onResolve,
}: ApprovalRendererProps): ReactNode {
  const patchText = extractPatchText(request.config, undefined);
  const files = useMemo(() => parseOpenAIPatch(patchText), [patchText]);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [edits] = useState<EditMap>(() => buildInitialEdits(request));
  const [submitting, setSubmitting] = useState(false);

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
        console.error("[PatchDiffApproval] onResolve failed", error);
        setSubmitting(false);
      }
    },
    [submitting, isPending, onResolve, request, answers, edits],
  );

  const disabled = submitting || !isPending;

  return (
    <Card data-testid="patch-diff-approval" className="my-3 not-prose">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Apply patch</div>
          {request.summary && (
            <div className="text-xs text-muted-foreground">{request.summary}</div>
          )}
          {files.length > 0 && <PatchSummary files={files} />}
        </div>
        <RiskPill level={request.riskLevel} />
      </CardHeader>

      <CardContent className="space-y-3">
        {files.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">(no patch to display)</div>
        ) : (
          files.map((file) => (
            <PatchFileSection key={`${file.action}:${file.path}`} file={file} />
          ))
        )}

        {request.questions.length > 0 && (
          <div className="space-y-3 pt-2" data-testid="approval-questions">
            {request.questions.map((q) => (
              <div key={q.index} className="space-y-2">
                <Label htmlFor={`pd-q-${q.index}`}>
                  {q.required ? `${q.question} *` : q.question}
                </Label>
                <Textarea
                  id={`pd-q-${q.index}`}
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

export default PatchDiffApproval;
