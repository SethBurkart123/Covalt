"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type {
  ApprovalOption,
  ApprovalQuestion,
  ApprovalRendererProps,
  ApprovalRequest,
} from "@/lib/renderers";
import {
  RISK_LABELS,
  buildOutcome,
  buttonVariantFor,
  isInputValid,
  type AnswerMap,
  type EditMap,
} from "@/components/approvals/approval-logic";

const DEFAULT_OPTIONS: ApprovalOption[] = [
  { value: "allow_once", label: "Approve", role: "allow_once" },
  { value: "deny", label: "Deny", role: "deny" },
];

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
  const fieldId = `terminal-approval-question-${question.index}`;
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

function readToolArgs(request: ApprovalRequest): Record<string, unknown> | undefined {
  return request.config?.toolArgs as Record<string, unknown> | undefined;
}

function readInitialCommand(request: ApprovalRequest): string {
  const args = readToolArgs(request);
  if (!args) return "";
  const command = args.command;
  if (typeof command === "string") return command;
  const cmd = args.cmd;
  if (typeof cmd === "string") return cmd;
  return "";
}

function readCwd(request: ApprovalRequest): string | undefined {
  const args = readToolArgs(request);
  if (!args) return undefined;
  return typeof args.cwd === "string" ? args.cwd : undefined;
}

function optionsFor(request: ApprovalRequest): ApprovalOption[] {
  return request.options.length > 0 ? request.options : DEFAULT_OPTIONS;
}

export function TerminalApproval({
  request,
  isPending,
  onResolve,
}: ApprovalRendererProps): ReactNode {
  const initialCommand = useMemo(() => readInitialCommand(request), [request]);
  const cwd = useMemo(() => readCwd(request), [request]);
  const isUserInput = request.kind === "user_input";

  const [command, setCommand] = useState<string>(initialCommand);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState<boolean>(false);

  const options = useMemo(() => optionsFor(request), [request]);

  const inputValid = useMemo(
    () => isInputValid(request, answers, {} as EditMap),
    [request, answers],
  );

  const handleSelect = useCallback(
    async (option: ApprovalOption) => {
      if (submitting || !isPending) return;
      setSubmitting(true);
      try {
        const isReject = option.role === "deny" || option.role === "abort";
        const baseOutcome = buildOutcome(request, option, answers, {} as EditMap);
        let editedArgs = baseOutcome.editedArgs;
        if (!isReject && !isUserInput && command !== initialCommand) {
          const baseArgs = readToolArgs(request) ?? {};
          editedArgs = { ...baseArgs, command };
        }
        await onResolve({ ...baseOutcome, editedArgs });
      } catch (error) {
        console.error("[TerminalApproval] onResolve failed", error);
        setSubmitting(false);
      }
    },
    [submitting, isPending, onResolve, request, answers, command, initialCommand, isUserInput],
  );

  const disabled = submitting || !isPending;

  return (
    <Card data-testid="terminal-approval" className="my-3 not-prose">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">
            {isUserInput ? "Input requested" : "Run command"}
          </div>
          {request.summary && (
            <div className="text-sm text-muted-foreground">{request.summary}</div>
          )}
        </div>
        <RiskPill level={request.riskLevel} />
      </CardHeader>

      <CardContent className="space-y-4">
        {!isUserInput && (
          <div className="space-y-2">
            <Label htmlFor="terminal-approval-command">Command</Label>
            <Textarea
              id="terminal-approval-command"
              data-testid="terminal-approval-command"
              value={command}
              disabled={disabled}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono text-xs min-h-[5rem]"
            />
            {cwd && (
              <div
                data-testid="terminal-approval-cwd"
                className="text-xs text-muted-foreground font-mono"
              >
                cwd: {cwd}
              </div>
            )}
          </div>
        )}

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
      </CardContent>

      <CardFooter className="flex flex-wrap justify-end gap-2 pt-3">
        {options.map((option) => {
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
