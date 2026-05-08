"use client";

import { CheckCircle2, Circle, ListTodo, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ToolRendererProps } from "@/lib/renderers/types";
import { cn } from "@/lib/utils";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id?: string;
  content: string;
  status: TodoStatus;
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isTodoLike(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.content === "string" && isTodoStatus(obj.status);
}

function coerceTodos(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter(isTodoLike);
  if (filtered.length === 0) return undefined;
  return filtered;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractTodos(
  config: Record<string, unknown> | undefined,
  toolArgs: Record<string, unknown> | undefined,
  toolResult: string | undefined,
): TodoItem[] | undefined {
  const fromConfig = coerceTodos(config?.todos);
  if (fromConfig) return fromConfig;
  const fromArgs = coerceTodos(toolArgs?.todos);
  if (fromArgs) return fromArgs;
  if (!toolResult) return undefined;
  const parsed = tryParse(toolResult);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const fromResult = coerceTodos(obj.todos);
    if (fromResult) return fromResult;
    const fromTop = coerceTodos(parsed);
    if (fromTop) return fromTop;
  }
  return undefined;
}

interface CountSummary {
  done: number;
  inProgress: number;
  pending: number;
}

function summarize(todos: TodoItem[]): CountSummary {
  let done = 0;
  let inProgress = 0;
  let pending = 0;
  for (const t of todos) {
    if (t.status === "completed") done += 1;
    else if (t.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { done, inProgress, pending };
}

interface TodoRowProps {
  todo: TodoItem;
  index: number;
}

function TodoRow({ todo, index }: TodoRowProps): React.ReactElement {
  const isCompleted = todo.status === "completed";
  const isInProgress = todo.status === "in_progress";
  return (
    <li
      className="flex items-start gap-2 text-sm"
      data-testid={`todo-item-${index}`}
      data-status={todo.status}
    >
      <span className="mt-0.5 shrink-0">
        {isCompleted && (
          <CheckCircle2
            className="h-4 w-4 text-green-600 dark:text-green-400"
            data-testid={`todo-icon-completed-${index}`}
          />
        )}
        {isInProgress && (
          <Loader2
            className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400"
            data-testid={`todo-icon-in-progress-${index}`}
          />
        )}
        {todo.status === "pending" && (
          <Circle
            className="h-4 w-4 text-muted-foreground"
            data-testid={`todo-icon-pending-${index}`}
          />
        )}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {index + 1}.
      </span>
      <span
        className={cn(
          "flex-1",
          isCompleted && "line-through text-muted-foreground",
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

export function TodoListRenderer({
  toolCall,
  config,
}: ToolRendererProps): React.ReactElement {
  const todos = extractTodos(config, toolCall.toolArgs, toolCall.toolResult);

  return (
    <Card className="p-4 gap-3" data-testid="todo-list-renderer">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Todos</span>
        {todos && todos.length > 0 && (
          <span
            className="ml-auto text-xs text-muted-foreground"
            data-testid="todo-list-counts"
          >
            {(() => {
              const s = summarize(todos);
              return `${s.done} done · ${s.inProgress} in progress · ${s.pending} pending`;
            })()}
          </span>
        )}
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
