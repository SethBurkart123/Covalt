"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/lib/renderers";
import { stripAnsi } from "./ansi-strip";

interface ResolvedFields {
  command: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  cwd: string | undefined;
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

function readResultField(result: unknown, key: string): unknown {
  if (result && typeof result === "object" && key in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>)[key];
  }
  return undefined;
}

interface ProgressLike {
  kind?: string;
  detail?: string;
}

function joinProgress(
  progress: ProgressLike[] | undefined,
  kind: "stdout" | "stderr",
): string {
  if (!Array.isArray(progress) || progress.length === 0) return "";
  return progress
    .filter((p) => (p?.kind ?? "other") === kind)
    .map((p) => p?.detail ?? "")
    .join("");
}

function resolveFields(
  toolArgs: Record<string, unknown> | undefined,
  result: unknown,
  config: Record<string, unknown> | undefined,
  progress: ProgressLike[] | undefined,
): ResolvedFields {
  const command =
    asString(config?.command) ?? asString(toolArgs?.command) ?? asString(toolArgs?.cmd) ?? null;

  const cfgOutput = asString(config?.output);
  const stdoutFromResult = asString(readResultField(result, "stdout"));
  const stderrFromResult = asString(readResultField(result, "stderr"));
  const outputFromResult = asString(readResultField(result, "output"));
  const stringResult = typeof result === "string" ? result : undefined;

  const progressStdout = joinProgress(progress, "stdout");
  const progressStderr = joinProgress(progress, "stderr");

  const stdout =
    cfgOutput ??
    stdoutFromResult ??
    outputFromResult ??
    stringResult ??
    progressStdout ??
    "";
  const stderr = stderrFromResult || progressStderr || "";

  const exitCode =
    asNumber(config?.exitCode) ??
    asNumber(readResultField(result, "exitCode")) ??
    asNumber(readResultField(result, "exit_code"));

  const cwd = asString(config?.cwd) ?? asString(toolArgs?.cwd);

  return { command, stdout, stderr, exitCode, cwd };
}

interface ExitPillProps {
  exitCode: number | undefined;
  running: boolean;
}

function ExitPill({ exitCode, running }: ExitPillProps): ReactNode {
  if (running) {
    return (
      <span
        data-testid="terminal-exit-pill"
        data-exit-state="running"
        className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono"
      >
        running…
      </span>
    );
  }
  if (exitCode === undefined) return null;
  const ok = exitCode === 0;
  return (
    <span
      data-testid="terminal-exit-pill"
      data-exit-state={ok ? "success" : "error"}
      className={cn(
        "text-xs px-2 py-0.5 rounded font-mono",
        ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive",
      )}
    >
      Exit {exitCode}
    </span>
  );
}

export function TerminalRenderer({
  toolCall,
  config,
  chatId: _chatId,
}: ToolRendererProps): ReactNode {
  void _chatId;
  const toolArgs = toolCall.toolArgs as Record<string, unknown> | undefined;
  const progress = (toolCall as { progress?: ProgressLike[] }).progress;
  const fields = useMemo(
    () => resolveFields(toolArgs, toolCall.toolResult, config, progress),
    [toolArgs, toolCall.toolResult, config, progress],
  );

  const cleanedStdout = useMemo(() => stripAnsi(fields.stdout), [fields.stdout]);
  const cleanedStderr = useMemo(() => stripAnsi(fields.stderr), [fields.stderr]);

  const fullOutput = useMemo(() => {
    if (cleanedStdout && cleanedStderr) return `${cleanedStdout}\n${cleanedStderr}`;
    return cleanedStdout || cleanedStderr;
  }, [cleanedStdout, cleanedStderr]);

  const running = fields.exitCode === undefined && !toolCall.isCompleted;
  const hasOutput = cleanedStdout.length > 0 || cleanedStderr.length > 0;

  const handleCopyCommand = useCallback(() => {
    if (!fields.command) return;
    void navigator.clipboard.writeText(fields.command);
  }, [fields.command]);

  const handleCopyOutput = useCallback(() => {
    if (!fullOutput) return;
    void navigator.clipboard.writeText(fullOutput);
  }, [fullOutput]);

  return (
    <Card data-testid="terminal-renderer" className="my-3 not-prose font-mono">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-3">
        <code
          data-testid="terminal-command"
          className="text-xs text-foreground truncate min-w-0 flex-1"
        >
          {fields.command ? `$ ${fields.command}` : "(no command)"}
        </code>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            data-testid="terminal-copy-command"
            size="xs"
            variant="ghost"
            disabled={!fields.command}
            onClick={handleCopyCommand}
          >
            Copy command
          </Button>
          <Button
            data-testid="terminal-copy-output"
            size="xs"
            variant="ghost"
            disabled={!fullOutput}
            onClick={handleCopyOutput}
          >
            Copy output
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0 border-t border-border">
        {running && !hasOutput ? (
          <div
            data-testid="terminal-running"
            className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"
          >
            <Spinner className="size-3" />
            <span>Running…</span>
          </div>
        ) : (
          <pre
            data-testid="terminal-output"
            className="max-h-96 overflow-auto px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words"
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
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 p-3 border-t border-border text-xs text-muted-foreground">
        <ExitPill exitCode={fields.exitCode} running={running} />
        {fields.cwd && (
          <span data-testid="terminal-cwd" className="truncate">
            {fields.cwd}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
