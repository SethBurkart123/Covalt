"use client";

import { useMemo, type ReactNode, type SVGProps } from "react";
import { CheckCircle2, Circle, ListTodo } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { cn } from "@/lib/utils";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id?: string;
  content: string;
  status: TodoStatus;
}

const STATUS_LINE = /^\d+\.\s*\[(completed|in_progress|pending)]\s*(.+)$/;

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isTodoLike(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    (typeof obj.content === "string" || typeof obj.text === "string")
    && isTodoStatus(obj.status)
  );
}

function coerceTodos(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const todos = value.filter(isTodoLike).map((item) => {
    const obj = item as TodoItem & { text?: string };
    return { ...obj, content: obj.content ?? obj.text ?? "" };
  });
  return todos.length > 0 ? todos : undefined;
}

function tryParse(text: string): unknown {
  const match = /^```(?:\w+)?\n([\s\S]*?)```\s*$/m.exec(text.trim());
  const raw = match ? match[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseTodoText(value: unknown): TodoItem[] | undefined {
  if (typeof value !== "string") return undefined;
  const todos: TodoItem[] = [];
  for (const line of value.split("\n")) {
    const match = STATUS_LINE.exec(line.trim());
    if (match) todos.push({ status: match[1] as TodoStatus, content: match[2] });
  }
  return todos.length > 0 ? todos : undefined;
}

function extractFromValue(value: unknown): TodoItem[] | undefined {
  const direct = coerceTodos(value) ?? parseTodoText(value);
  if (direct) return direct;
  if (typeof value !== "string") return undefined;
  const parsed = tryParse(value);
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  return coerceTodos(obj.todos) ?? parseTodoText(obj.todos) ?? coerceTodos(parsed);
}

function extractTodos(
  config: Record<string, unknown> | undefined,
  toolArgs: Record<string, unknown> | undefined,
  toolResult: unknown,
  progress: ToolCallRendererProps["progress"],
): TodoItem[] | undefined {
  for (const entry of [...(progress ?? [])].reverse()) {
    const fromProgress = extractFromValue(entry.detail);
    if (fromProgress) return fromProgress;
  }
  return (
    extractFromValue(config?.todos)
    ?? extractFromValue(toolArgs?.todos)
    ?? extractFromValue(toolResult)
  );
}

function InProgressIcon({ className, ...props }: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg
      data-testid="todo-icon-in-progress-marker"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeDasharray="4.2 3.654"
        strokeLinecap="butt"
      />
      <line x1="8" y1="12" x2="16" y2="12" />
      <polyline points="12 8 16 12 12 16" />
    </svg>
  );
}

interface TodoRowProps {
  todo: TodoItem;
  index: number;
}

function TodoRow({ todo, index }: TodoRowProps): ReactNode {
  const isCompleted = todo.status === "completed";
  const isInProgress = todo.status === "in_progress";
  return (
    <li
      className={cn(
        "flex items-center gap-2 text-sm",
        isCompleted && "text-muted-foreground line-through",
        !isCompleted && !isInProgress && "text-foreground/60",
        isInProgress && "text-primary",
      )}
      data-testid={`todo-item-${index}`}
      data-status={todo.status}
    >
      <span className="shrink-0 h-4 w-4 inline-flex items-center justify-center">
        {isCompleted && (
          <CheckCircle2
            className="h-4 w-4 text-primary"
            data-testid={`todo-icon-completed-${index}`}
          />
        )}
        {isInProgress && <InProgressIcon data-testid={`todo-icon-in-progress-${index}`} />}
        {todo.status === "pending" && (
          <Circle
            className="h-4 w-4"
            data-testid={`todo-icon-pending-${index}`}
          />
        )}
      </span>
      <span className="flex-1 min-w-0">{todo.content}</span>
    </li>
  );
}

export function TodoListRenderer({
  toolArgs,
  toolResult,
  renderPlan,
  progress,
}: ToolCallRendererProps): ReactNode {
  const todos = useMemo(
    () => extractTodos(renderPlan?.config, toolArgs, toolResult, progress),
    [renderPlan?.config, toolArgs, toolResult, progress],
  );

  return (
    <Card className="p-4 gap-3" data-testid="todo-list-renderer">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Todos</span>
      </div>
      {!todos || todos.length === 0 ? (
        <div
          className="text-sm text-muted-foreground"
          data-testid="todo-list-empty"
        >
          No todos
        </div>
      ) : (
        <ol
          className="flex flex-col gap-1.5 list-none"
          data-testid="todo-list-items"
        >
          {todos.map((todo, i) => (
            <TodoRow key={todo.id ?? `${i}-${todo.content}`} todo={todo} index={i} />
          ))}
        </ol>
      )}
    </Card>
  );
}

export default TodoListRenderer;
