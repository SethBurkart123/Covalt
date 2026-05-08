import type {
  ApprovalEditable,
  ApprovalOption,
  ApprovalOutcome,
  ApprovalQuestion,
  ApprovalRequest,
} from "@/lib/renderers";

export type AnswerMap = Record<number, string>;
export type EditMap = Record<string, unknown>;

export function pathKey(path: string[]): string {
  return path.join(".");
}

export function getValueAtPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setValueAtPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const next = cursor[segment];
    if (!next || typeof next !== "object") {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

export function schemaType(schema: Record<string, unknown>): string {
  const t = schema.type;
  return typeof t === "string" ? t : "string";
}

export function schemaRequired(schema: Record<string, unknown>): boolean {
  return Boolean(schema.required);
}

export function defaultForSchema(schema: Record<string, unknown>): unknown {
  switch (schemaType(schema)) {
    case "boolean":
      return false;
    default:
      return "";
  }
}

export function answerValid(question: ApprovalQuestion, value: string | undefined): boolean {
  if (!question.required) return true;
  return Boolean(value && value.trim().length > 0);
}

export function editableValid(field: ApprovalEditable, value: unknown): boolean {
  if (!schemaRequired(field.schema)) return true;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function buildInitialEdits(request: ApprovalRequest): EditMap {
  const initial: EditMap = {};
  const args = request.config?.toolArgs as Record<string, unknown> | undefined;
  for (const field of request.editable) {
    const key = pathKey(field.path);
    const seed = args ? getValueAtPath(args, field.path) : undefined;
    initial[key] = seed ?? defaultForSchema(field.schema);
  }
  return initial;
}

export function isInputValid(
  request: ApprovalRequest,
  answers: AnswerMap,
  edits: EditMap,
): boolean {
  for (const q of request.questions) {
    if (!answerValid(q, answers[q.index])) return false;
  }
  for (const f of request.editable) {
    if (!editableValid(f, edits[pathKey(f.path)])) return false;
  }
  return true;
}

export function composeEditedArgs(
  request: ApprovalRequest,
  edits: EditMap,
): Record<string, unknown> | undefined {
  if (request.editable.length === 0) return undefined;
  const baseArgs = (request.config?.toolArgs as Record<string, unknown> | undefined) ?? {};
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(baseArgs));
  let touched = false;
  for (const field of request.editable) {
    const key = pathKey(field.path);
    const value = edits[key];
    const original = getValueAtPath(baseArgs, field.path);
    if (value === original) continue;
    setValueAtPath(out, field.path, value);
    touched = true;
  }
  return touched ? out : undefined;
}

export function buildOutcome(
  request: ApprovalRequest,
  option: ApprovalOption,
  answers: AnswerMap,
  edits: EditMap,
): ApprovalOutcome {
  const isReject = option.role === "deny" || option.role === "abort";
  return {
    selectedOption: option.value,
    answers: request.questions.map((q) => ({
      index: q.index,
      answer: answers[q.index] ?? "",
    })),
    editedArgs: isReject ? undefined : composeEditedArgs(request, edits),
  };
}

export function buttonVariantFor(
  option: ApprovalOption,
): "default" | "destructive" | "outline" | "secondary" {
  if (option.style === "destructive" || option.role === "deny" || option.role === "abort") {
    return "destructive";
  }
  if (option.style === "primary") return "default";
  if (
    option.role === "allow_once"
    || option.role === "allow_session"
    || option.role === "allow_always"
  ) {
    return "default";
  }
  return "outline";
}

export const RISK_LABELS: Record<string, string> = {
  high: "High Risk",
  medium: "Medium Risk",
  low: "Low Risk",
};
