"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type {
  ApprovalEditable,
  ApprovalOption,
  ApprovalQuestion,
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
  schemaRequired,
  schemaType,
  type AnswerMap,
  type EditMap,
} from "./approval-logic";

interface RiskPillProps {
  level: ApprovalRequest["riskLevel"];
}

function RiskPill({ level }: RiskPillProps): ReactNode {
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

interface QuestionFieldProps {
  question: ApprovalQuestion;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function QuestionField({ question, value, disabled, onChange }: QuestionFieldProps): ReactNode {
  const fieldId = `approval-question-${question.index}`;
  const labelText = question.required ? `${question.question} *` : question.question;

  if (question.options && question.options.length > 0) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{labelText}</Label>
        <RadioGroup id={fieldId} value={value} onValueChange={onChange} disabled={disabled}>
          {question.options.map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              <RadioGroupItem value={opt} id={`${fieldId}-${opt}`} />
              <Label htmlFor={`${fieldId}-${opt}`}>{opt}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (question.multiline) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{labelText}</Label>
        <Textarea
          id={fieldId}
          value={value}
          placeholder={question.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{labelText}</Label>
      <Input
        id={fieldId}
        value={value}
        placeholder={question.placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface EditableFieldProps {
  field: ApprovalEditable;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function EditableField({ field, value, disabled, onChange }: EditableFieldProps): ReactNode {
  const fieldId = `approval-editable-${pathKey(field.path)}`;
  const label = field.label ?? field.path.join(".");
  const labelText = schemaRequired(field.schema) ? `${label} *` : label;
  const type = schemaType(field.schema);

  if (type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={fieldId}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        <Label htmlFor={fieldId}>{labelText}</Label>
      </div>
    );
  }

  const stringValue = value == null ? "" : String(value);

  if (field.schema.format === "multiline" || type === "text") {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{labelText}</Label>
        <Textarea
          id={fieldId}
          value={stringValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{labelText}</Label>
      <Input
        id={fieldId}
        type={type === "number" || type === "integer" ? "number" : "text"}
        value={stringValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ToolArgsPreviewProps {
  args: Record<string, unknown>;
}

function ToolArgsPreview({ args }: ToolArgsPreviewProps): ReactNode {
  return (
    <details className="rounded-md border border-border bg-muted/30">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none">
        Tool arguments
      </summary>
      <pre
        data-testid="approval-tool-args"
        className="px-3 pb-3 pt-1 text-xs overflow-x-auto whitespace-pre-wrap break-words"
      >
        {JSON.stringify(args, null, 2)}
      </pre>
    </details>
  );
}

export function DefaultApproval({
  request,
  isPending,
  onResolve,
}: ApprovalRendererProps): ReactNode {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [edits, setEdits] = useState<EditMap>(() => buildInitialEdits(request));
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
        console.error("[DefaultApproval] onResolve failed", error);
        setSubmitting(false);
      }
    },
    [submitting, isPending, onResolve, request, answers, edits],
  );

  const disabled = submitting || !isPending;
  const toolArgs = request.config?.toolArgs as Record<string, unknown> | undefined;
  const hasBody =
    request.questions.length > 0 || request.editable.length > 0 || Boolean(toolArgs);

  return (
    <Card data-testid="default-approval" className="my-3 not-prose">
      {(request.summary || request.riskLevel) && (
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="text-sm text-foreground">{request.summary}</div>
          <RiskPill level={request.riskLevel} />
        </CardHeader>
      )}

      {hasBody && (
        <CardContent className="space-y-4">
          {request.questions.length > 0 && (
            <div className="space-y-3" data-testid="approval-questions">
              {request.questions.map((q) => (
                <QuestionField
                  key={q.index}
                  question={q}
                  value={answers[q.index] ?? ""}
                  disabled={disabled}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.index]: v }))}
                />
              ))}
            </div>
          )}

          {request.editable.length > 0 && (
            <div className="space-y-3" data-testid="approval-editables">
              {request.editable.map((field) => (
                <EditableField
                  key={pathKey(field.path)}
                  field={field}
                  value={edits[pathKey(field.path)]}
                  disabled={disabled}
                  onChange={(v) =>
                    setEdits((prev) => ({ ...prev, [pathKey(field.path)]: v }))
                  }
                />
              ))}
            </div>
          )}

          {toolArgs && Object.keys(toolArgs).length > 0 && (
            <ToolArgsPreview args={toolArgs} />
          )}
        </CardContent>
      )}

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
