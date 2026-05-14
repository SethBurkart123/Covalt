
import {
  useMemo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { diffLines } from "diff/lib/diff/line.js";
import type { ChangeObject } from "diff/lib/types.js";
import { Prism } from "prism-react-renderer";
import { FileCode2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { detectLanguage } from "../file-read/detect-language";

export interface DiffCounts {
  additions: number;
  deletions: number;
}

const MAX_HIGHLIGHT_CHARS = 250_000;
const MAX_HIGHLIGHT_LINES = 2_500;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 2_000;
const DIFF_TIMEOUT_MS = 16;
const DIFF_MAX_EDIT_LENGTH = 4_000;

const PRISM_SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: ["span"],
  ALLOWED_ATTR: ["class"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
};

const highlightedLineCache = new Map<string, string>();

function shouldHighlight(oldText: string, newText: string): boolean {
  const maxChars = Math.max(oldText.length, newText.length);
  if (maxChars > MAX_HIGHLIGHT_CHARS) return false;
  const oldLines = oldText.length === 0 ? 0 : oldText.split("\n").length;
  const newLines = newText.length === 0 ? 0 : newText.split("\n").length;
  if (Math.max(oldLines, newLines) > MAX_HIGHLIGHT_LINES) return false;
  return true;
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

export type DiffRowKind = "context" | "add" | "delete";

export interface DiffRow {
  kind: DiffRowKind;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
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

function getCachedHighlightedLine(text: string, language: string): string {
  const cacheKey = `${language}\0${text}`;
  const cached = highlightedLineCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const grammar = Prism.languages[language] ?? Prism.languages.text;
  const html = grammar ? Prism.highlight(text, grammar, language) : text;
  const sanitized = DOMPurify.sanitize(html, PRISM_SANITIZE_CONFIG);

  highlightedLineCache.set(cacheKey, sanitized);
  if (highlightedLineCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldestKey = highlightedLineCache.keys().next().value;
    if (oldestKey !== undefined) highlightedLineCache.delete(oldestKey);
  }
  return sanitized;
}

function highlightLine(text: string, language: string): ReactElement {
  if (text.length === 0) return <span>&nbsp;</span>;
  return (
    <span
      className="code-tokens"
      dangerouslySetInnerHTML={{ __html: getCachedHighlightedLine(text, language) }}
    />
  );
}

function splitChangeLines(value: string): string[] {
  if (value.length === 0) return [];

  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\n") continue;
    lines.push(stripCarriageReturn(value.slice(start, i)));
    start = i + 1;
  }
  if (start < value.length) lines.push(stripCarriageReturn(value.slice(start)));
  return lines;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function rowsFromChanges(changes: ChangeObject<string>[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (const change of changes) {
    const lines = splitChangeLines(change.value);
    if (change.added) {
      for (const content of lines) {
        rows.push({ kind: "add", newLineNumber, content });
        newLineNumber += 1;
      }
      continue;
    }

    if (change.removed) {
      for (const content of lines) {
        rows.push({ kind: "delete", oldLineNumber, content });
        oldLineNumber += 1;
      }
      continue;
    }

    for (const content of lines) {
      rows.push({ kind: "context", oldLineNumber, newLineNumber, content });
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  }

  return rows;
}

function splitTextLines(value: string): string[] {
  return splitChangeLines(value);
}

function buildFallbackRows(oldText: string, newText: string): DiffRow[] {
  const oldLines = splitTextLines(oldText);
  const newLines = splitTextLines(newText);
  const rows: DiffRow[] = [];

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    rows.push({
      kind: "context",
      oldLineNumber: prefix + 1,
      newLineNumber: prefix + 1,
      content: oldLines[prefix],
    });
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) {
    suffix += 1;
  }

  for (let i = prefix; i < oldLines.length - suffix; i += 1) {
    rows.push({ kind: "delete", oldLineNumber: i + 1, content: oldLines[i] });
  }

  for (let i = prefix; i < newLines.length - suffix; i += 1) {
    rows.push({ kind: "add", newLineNumber: i + 1, content: newLines[i] });
  }

  for (let i = oldLines.length - suffix; i < oldLines.length; i += 1) {
    const newLineNumber = newLines.length - oldLines.length + i + 1;
    rows.push({
      kind: "context",
      oldLineNumber: i + 1,
      newLineNumber,
      content: oldLines[i],
    });
  }

  return rows;
}

export function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const changes = diffLines(oldText, newText, {
    timeout: DIFF_TIMEOUT_MS,
    maxEditLength: DIFF_MAX_EDIT_LENGTH,
  });
  if (!changes) return buildFallbackRows(oldText, newText);
  return rowsFromChanges(changes);
}

function rowClassName(kind: DiffRowKind): string {
  if (kind === "add") return "bg-success/10";
  if (kind === "delete") return "bg-destructive/10";
  return "bg-transparent";
}

function markerForKind(kind: DiffRowKind): string {
  if (kind === "add") return "+";
  if (kind === "delete") return "-";
  return "";
}

interface DiffBodyProps {
  oldContent: string;
  newContent: string;
  language: string;
  highlight: boolean;
}

function DiffBody({
  oldContent,
  newContent,
  language,
  highlight,
}: DiffBodyProps): ReactNode {
  const rows = useMemo(
    () => buildDiffRows(oldContent, newContent),
    [oldContent, newContent],
  );
  const maxLineNumber = Math.max(
    rows.at(-1)?.oldLineNumber ?? 0,
    rows.at(-1)?.newLineNumber ?? 0,
    splitTextLines(oldContent).length,
    splitTextLines(newContent).length,
    1,
  );
  const gutterWidth = `${String(maxLineNumber).length + 2}ch`;
  const style = { "--diff-gutter-width": gutterWidth } as CSSProperties;

  return (
    <div className="code-tokens min-w-full font-mono text-xs leading-5" style={style}>
      {rows.map((row, index) => (
        <div
          key={`${row.kind}-${row.oldLineNumber ?? ""}-${row.newLineNumber ?? ""}-${index}`}
          className={cn(
            "grid min-w-full grid-cols-[var(--diff-gutter-width)_var(--diff-gutter-width)_1.25rem_minmax(0,1fr)] items-start",
            rowClassName(row.kind),
          )}
        >
          <span className="select-none border-r border-border/60 px-2 text-right text-muted-foreground/60 tabular-nums">
            {row.oldLineNumber ?? ""}
          </span>
          <span className="select-none border-r border-border/60 px-2 text-right text-muted-foreground/60 tabular-nums">
            {row.newLineNumber ?? ""}
          </span>
          <span
            className={cn(
              "select-none text-center",
              row.kind === "add" && "text-success",
              row.kind === "delete" && "text-destructive",
              row.kind === "context" && "text-muted-foreground/50",
            )}
            aria-hidden="true"
          >
            {markerForKind(row.kind)}
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-all px-3 text-foreground">
            {highlight
              ? highlightLine(row.content, language)
              : row.content || <span>&nbsp;</span>}
          </span>
        </div>
      ))}
    </div>
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
  headless?: boolean;
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
}: DiffViewProps): ReactNode {
  const highlight = useMemo(
    () => shouldHighlight(oldContent, newContent),
    [oldContent, newContent],
  );
  const counts = useMemo<DiffCounts>(() => {
    if (precomputedCounts) return precomputedCounts;
    return countDiffLines(oldContent, newContent);
  }, [oldContent, newContent, precomputedCounts]);

  const resolvedLanguage = useMemo(() => {
    const lang = detectLanguage(filePath ?? "", language);
    return lang === "plaintext" ? "text" : lang;
  }, [filePath, language]);

  const hasContent = oldContent.length > 0 || newContent.length > 0;
  const headerLabel = label ?? filePath ?? "Edit";

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
            <DiffBody
              oldContent={oldContent}
              newContent={newContent}
              language={resolvedLanguage}
              highlight={highlight}
            />
          </div>
        ) : (
          <div className="px-3 py-2 text-xs italic text-muted-foreground">(no diff available)</div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="diff-view"
      data-file-path={filePath ?? ""}
      className={cn("overflow-hidden rounded-md border border-border bg-card", className)}
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
          <DiffBody
            oldContent={oldContent}
            newContent={newContent}
            language={resolvedLanguage}
            highlight={highlight}
          />
        </div>
      ) : (
        <div className="px-3 py-2 text-xs italic text-muted-foreground">(no diff available)</div>
      )}
    </div>
  );
}
