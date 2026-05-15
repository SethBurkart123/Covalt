"use client";

import { useMemo, type ReactNode } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { FileCode2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { useDiffTheme } from "@/lib/hooks/use-diff-theme";
import { detectLanguage } from "../file-read/detect-language";

export interface DiffCounts {
  additions: number;
  deletions: number;
}

export function countDiffLines(oldText: string, newText: string): DiffCounts {
  const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
  const newLines = newText.length === 0 ? [] : newText.split("\n");
  const oldCounts = new Map<string, number>();
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
  const newCounts = new Map<string, number>();
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

  let additions = 0;
  for (const [line, count] of newCounts) {
    const matched = Math.min(count, oldCounts.get(line) ?? 0);
    additions += count - matched;
  }
  let deletions = 0;
  for (const [line, count] of oldCounts) {
    const matched = Math.min(count, newCounts.get(line) ?? 0);
    deletions += count - matched;
  }
  return { additions, deletions };
}

function DiffStats({ additions, deletions }: DiffCounts): ReactNode {
  if (additions === 0 && deletions === 0) {
    return <span className="text-xs text-muted-foreground">no changes</span>;
  }
  return (
    <span className="flex items-center gap-2 text-xs font-mono">
      {additions > 0 && (
        <span className="flex items-center gap-0.5 text-success">
          <Plus className="size-3" />
          {additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="flex items-center gap-0.5 text-destructive">
          <Minus className="size-3" />
          {deletions}
        </span>
      )}
    </span>
  );
}

export { DiffStats };

export interface DiffViewProps {
  filePath?: string;
  label?: string;
  oldContent: string;
  newContent: string;
  language?: string;
  precomputedCounts?: DiffCounts;
  className?: string;
  /** Caller (e.g. an outer Collapsible) already provides chrome; render only the diff body. */
  headless?: boolean;
  /** Render Pierre's full chrome (header + stats) with no wrapper at all. */
  disableCollapsibleChrome?: boolean;
}

function EmptyState(): ReactNode {
  return (
    <div className="px-3 py-2 text-xs italic text-muted-foreground">
      (no diff available)
    </div>
  );
}

export function DiffView({
  filePath,
  label,
  oldContent,
  newContent,
  language,
  precomputedCounts,
  className,
  headless = false,
  disableCollapsibleChrome = false,
}: DiffViewProps): ReactNode {
  const diffTheme = useDiffTheme();
  const resolvedLanguage = useMemo(() => {
    const lang = detectLanguage(filePath ?? "", language);
    return lang === "plaintext" ? "text" : lang;
  }, [filePath, language]);

  const oldFile = useMemo(
    () => ({
      name: filePath ?? "old",
      contents: oldContent,
      lang: resolvedLanguage,
    }),
    [filePath, oldContent, resolvedLanguage],
  );
  const newFile = useMemo(
    () => ({
      name: filePath ?? "new",
      contents: newContent,
      lang: resolvedLanguage,
    }),
    [filePath, newContent, resolvedLanguage],
  );

  const fileDiff = useMemo(
    () => parseDiffFromFile(oldFile, newFile),
    [oldFile, newFile],
  );

  const hasContent = oldContent.length > 0 || newContent.length > 0;
  const counts = useMemo<DiffCounts>(() => {
    if (precomputedCounts) return precomputedCounts;
    return countDiffLines(oldContent, newContent);
  }, [oldContent, newContent, precomputedCounts]);

  if (disableCollapsibleChrome) {
    return (
      <div
        data-testid="diff-view"
        data-file-path={filePath ?? ""}
        className={className}
      >
        {hasContent ? (
          <FileDiff
            fileDiff={fileDiff}
            options={{
              diffStyle: "split",
              theme: diffTheme,
            }}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    );
  }

  if (headless) {
    return (
      <div
        data-testid="diff-view"
        data-file-path={filePath ?? ""}
        className={className}
      >
        {hasContent ? (
          <div
            data-testid="diff-body"
            className="max-h-[32rem] overflow-auto bg-background/5"
          >
            <FileDiff
              fileDiff={fileDiff}
              options={{
                diffStyle: "split",
                theme: diffTheme,
                disableFileHeader: true,
              }}
            />
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    );
  }

  const headerLabel = label ?? filePath ?? "Edit";
  return (
    <div
      data-testid="diff-view"
      data-file-path={filePath ?? ""}
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
          <MiddleTruncate
            text={headerLabel}
            className="flex-1 font-mono text-xs text-foreground"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DiffStats additions={counts.additions} deletions={counts.deletions} />
        </div>
      </div>
      {hasContent ? (
        <div
          data-testid="diff-body"
          className="max-h-[32rem] overflow-auto bg-background/5"
        >
          <FileDiff
            fileDiff={fileDiff}
            options={{
              diffStyle: "split",
              theme: diffTheme,
              disableFileHeader: true,
            }}
          />
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
