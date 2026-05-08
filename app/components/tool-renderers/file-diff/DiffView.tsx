"use client";

import { useMemo, type ReactNode } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { FileCode2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

export interface DiffCounts {
  additions: number;
  deletions: number;
}

export function countDiffLines(oldText: string, newText: string): DiffCounts {
  const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
  const newLines = newText.length === 0 ? [] : newText.split("\n");
  const oldSet = new Map<string, number>();
  for (const line of oldLines) oldSet.set(line, (oldSet.get(line) ?? 0) + 1);
  const newSet = new Map<string, number>();
  for (const line of newLines) newSet.set(line, (newSet.get(line) ?? 0) + 1);

  let additions = 0;
  for (const [line, count] of newSet) {
    const matched = Math.min(count, oldSet.get(line) ?? 0);
    additions += count - matched;
  }
  let deletions = 0;
  for (const [line, count] of oldSet) {
    const matched = Math.min(count, newSet.get(line) ?? 0);
    deletions += count - matched;
  }
  return { additions, deletions };
}

interface DiffStatsProps {
  additions: number;
  deletions: number;
}

function DiffStats({ additions, deletions }: DiffStatsProps): ReactNode {
  if (additions === 0 && deletions === 0) {
    return <span className="text-xs text-muted-foreground">no changes</span>;
  }
  return (
    <span className="flex items-center gap-2 text-xs font-mono">
      {additions > 0 && (
        <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
          <Plus className="size-3" />
          {additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
          <Minus className="size-3" />
          {deletions}
        </span>
      )}
    </span>
  );
}

export interface DiffViewProps {
  filePath?: string;
  label?: string;
  oldContent: string;
  newContent: string;
  splitView?: boolean;
  precomputedCounts?: DiffCounts;
  onCopyPath?: () => void;
  className?: string;
}

export function DiffView({
  filePath,
  label,
  oldContent,
  newContent,
  splitView = true,
  precomputedCounts,
  onCopyPath,
  className,
}: DiffViewProps): ReactNode {
  const theme = useResolvedTheme();
  const counts = useMemo(
    () => precomputedCounts ?? countDiffLines(oldContent, newContent),
    [oldContent, newContent, precomputedCounts],
  );
  const hasContent = oldContent.length > 0 || newContent.length > 0;
  const headerLabel = label ?? filePath ?? "Edit";

  return (
    <div
      data-testid="diff-view"
      data-file-path={filePath ?? ""}
      className={cn("overflow-hidden rounded-md border border-border bg-card", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-foreground">{headerLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DiffStats additions={counts.additions} deletions={counts.deletions} />
          {filePath && onCopyPath && (
            <button
              type="button"
              onClick={onCopyPath}
              data-testid="diff-copy-path"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              copy
            </button>
          )}
        </div>
      </div>
      {hasContent ? (
        <div className="text-xs">
          <ReactDiffViewer
            oldValue={oldContent}
            newValue={newContent}
            splitView={splitView}
            useDarkTheme={theme === "dark"}
            hideLineNumbers={false}
          />
        </div>
      ) : (
        <div className="px-3 py-2 text-xs italic text-muted-foreground">(no diff available)</div>
      )}
    </div>
  );
}
