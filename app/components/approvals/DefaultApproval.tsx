"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArgumentsDisplay } from "@/components/tool-renderers/default/ArgumentsDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseToolDisplayParts } from "@/lib/tooling";
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
} from "./approval-logic";

const ASK_USER_TOOL_LABEL = "ask_user";

export interface DefaultApprovalProps extends ApprovalRendererProps {
  renderBody?: (ctx: DefaultApprovalRenderContext) => ReactNode;
  hideArguments?: boolean;
  fallbackToolName?: string;
}

export interface DefaultApprovalRenderContext {
  request: ApprovalRequest;
  toolArgs: Record<string, unknown> | undefined;
  edits: EditMap;
  setEdit: (key: string, value: unknown) => void;
  disabled: boolean;
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

function topLevelEditableKeys(request: ApprovalRequest): string[] {
  const keys: string[] = [];
  for (const f of request.editable) {
    if (f.path.length === 1 && !keys.includes(f.path[0])) keys.push(f.path[0]);
  }
  return keys;
}

function buildSeedArgs(request: ApprovalRequest): Record<string, unknown> {
  const base = (request.config?.toolArgs as Record<string, unknown> | undefined) ?? {};
  return base;
}

function optionPrecedence(option: ApprovalOption): number {
  if (option.role === "deny" || option.role === "abort" || option.style === "destructive") {
    return 0;
  }
  if (option.role === "allow_session" || option.role === "allow_always") return 1;
  if (option.role === "allow_once") return 2;
  if (option.style === "primary") return 3;
  return 1;
}

function orderOptionsForFooter(options: readonly ApprovalOption[]): ApprovalOption[] {
  return [...options].sort((a, b) => optionPrecedence(a) - optionPrecedence(b));
}

export function DefaultApproval({
  request,
  isPending,
  onResolve,
  renderBody,
  hideArguments,
  fallbackToolName,
}: DefaultApprovalProps): ReactNode {
  const seedArgs = useMemo(() => buildSeedArgs(request), [request]);
  const editableKeys = useMemo(() => topLevelEditableKeys(request), [request]);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [editedFields, setEditedFields] = useState<EditMap>({});
  const [submitting, setSubmitting] = useState(false);

  const edits = useMemo<EditMap>(() => {
    const out: EditMap = { ...editedFields };
    for (const key of editableKeys) {
      if (!(key in out)) out[key] = seedArgs[key];
    }
    return out;
  }, [editableKeys, editedFields, seedArgs]);

  const setEditedField = useCallback((key: string, value: unknown) => {
    setEditedFields((prev) => ({ ...prev, [key]: value }));
  }, []);

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
  const showArguments = !hideArguments && Object.keys(seedArgs).length > 0;
  const isUserInput = request.kind === "user_input";
  const toolNameForDisplay =
    request.toolName ?? fallbackToolName ?? (isUserInput ? ASK_USER_TOOL_LABEL : "tool");
  const toolDisplay = parseToolDisplayParts(toolNameForDisplay);
  const toolCallTestId = `approval-${toolNameForDisplay}`;

  const renderContext: DefaultApprovalRenderContext = useMemo(
    () => ({
      request,
      toolArgs: seedArgs,
      edits,
      setEdit: setEditedField,
      disabled,
    }),
    [request, seedArgs, edits, disabled, setEditedField],
  );

  return (
    <Collapsible
      open
      onOpenChange={() => undefined}
      disableToggle
      shimmer={false}
      data-testid="default-approval"
      data-approval-test-id={toolCallTestId}
    >
      <CollapsibleTrigger rightContent={<RiskPill level={request.riskLevel} />}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Wrench} />
          {request.summary ? (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <span
                  className="text-sm font-mono text-foreground cursor-help"
                  data-testid="approval-tool-name"
                >
                  {toolDisplay.namespace ? (
                    <>
                      <span>{toolDisplay.label}</span>
                      <span className="px-2 italic text-muted-foreground align-middle">
                        {toolDisplay.namespace}
                      </span>
                    </>
                  ) : (
                    toolDisplay.label
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" align="start">
                {request.summary}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span
              className="text-sm font-mono text-foreground"
              data-testid="approval-tool-name"
            >
              {toolDisplay.namespace ? (
                <>
                  <span>{toolDisplay.label}</span>
                  <span className="px-2 italic text-muted-foreground align-middle">
                    {toolDisplay.namespace}
                  </span>
                </>
              ) : (
                toolDisplay.label
              )}
            </span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {renderBody && (
          <div data-testid="approval-body">{renderBody(renderContext)}</div>
        )}

        {showArguments && (
          <div data-testid="approval-tool-args">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Arguments
            </div>
            <ArgumentsDisplay
              args={seedArgs}
              editableArgs={editableKeys.length > 0 ? editableKeys : undefined}
              editedValues={editedFields}
              onValueChange={setEditedField}
            />
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

        <div className="flex flex-wrap justify-end gap-2 pt-3">
          {orderOptionsForFooter(request.options).map((option) => {
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default DefaultApproval;
