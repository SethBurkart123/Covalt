
import { useMemo, useState, type ReactNode } from "react";
import { Terminal } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { cn } from "@/lib/utils";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import type { ProgressEntry } from "@/lib/types/chat";
import { stripAnsi } from "./ansi-strip";

interface ResolvedFields {
  command: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readField(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function parseToolResult(result: unknown): Record<string, unknown> | string | undefined {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        return result;
      }
    }
    return result;
  }
  if (result && typeof result === "object") return result as Record<string, unknown>;
  return undefined;
}

function joinProgress(progress: ProgressEntry[] | undefined, kind: "stdout" | "stderr"): string {
  if (!Array.isArray(progress) || progress.length === 0) return "";
  return progress
    .filter((p) => (p?.kind ?? "other") === kind)
    .map((p) => p?.detail ?? "")
    .join("");
}

function resolveFields(
  toolArgs: Record<string, unknown> | undefined,
  toolResult: unknown,
  config: Record<string, unknown> | undefined,
  progress: ProgressEntry[] | undefined,
): ResolvedFields {
  const command =
    asString(config?.command) ?? asString(toolArgs?.command) ?? asString(toolArgs?.cmd) ?? null;

  const parsed = parseToolResult(toolResult);
  const stdoutFromResult =
    typeof parsed === "string"
      ? parsed
      : asString(readField(parsed, "stdout")) ?? asString(readField(parsed, "output"));
  const stderrFromResult =
    typeof parsed === "string" ? undefined : asString(readField(parsed, "stderr"));

  const stdout =
    asString(config?.output) ?? stdoutFromResult ?? joinProgress(progress, "stdout") ?? "";
  const stderr = stderrFromResult ?? joinProgress(progress, "stderr") ?? "";

  const exitCode =
    asNumber(config?.exitCode) ??
    asNumber(readField(parsed, "exitCode")) ??
    asNumber(readField(parsed, "exit_code"));

  return { command, stdout, stderr, exitCode };
}

function ExitPill({ exitCode }: { exitCode: number | undefined }): ReactNode {
  if (exitCode === undefined) return null;
  const ok = exitCode === 0;
  return (
    <span
      data-testid="terminal-exit-pill"
      data-exit-state={ok ? "success" : "error"}
      className={cn(
        "text-xs px-2 py-0.5 rounded font-mono",
        ok
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive",
      )}
    >
      Exit {exitCode}
    </span>
  );
}

export function TerminalRenderer({
  toolArgs,
  toolResult,
  isCompleted,
  progress,
  renderPlan,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps): ReactNode {
  const config = renderPlan?.config;
  const fields = useMemo(
    () => resolveFields(toolArgs, toolResult, config, progress),
    [toolArgs, toolResult, config, progress],
  );

  const cleanedStdout = useMemo(() => stripAnsi(fields.stdout), [fields.stdout]);
  const cleanedStderr = useMemo(() => stripAnsi(fields.stderr), [fields.stderr]);

  const running = fields.exitCode === undefined && !isCompleted;
  const hasOutput = cleanedStdout.length > 0 || cleanedStderr.length > 0;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={running}
      mode={mode}
      data-testid="terminal-renderer"
      data-toolcall
    >
      <CollapsibleTrigger
        rightContent={<ExitPill exitCode={fields.exitCode} />}
      >
        <CollapsibleHeader>
          <CollapsibleIcon icon={Terminal} />
          <MiddleTruncate
            data-testid="terminal-command"
            text={fields.command ? `$ ${fields.command}` : "(no command)"}
            className="flex-1 text-sm font-mono text-foreground"
          />
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <pre
          data-testid="terminal-output"
          className="max-h-96 overflow-auto text-xs leading-relaxed font-mono whitespace-pre-wrap break-words"
        >
          {cleanedStdout && <span>{cleanedStdout}</span>}
          {cleanedStdout && cleanedStderr && "\n"}
          {cleanedStderr && (
            <span className="text-destructive">{cleanedStderr}</span>
          )}
          {!hasOutput && (
            <span className="text-muted-foreground">(no output)</span>
          )}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
