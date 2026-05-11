"use client";

import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import ReactDiffViewer, {
  DiffMethod,
  type ReactDiffViewerStylesOverride,
} from "react-diff-viewer-continued";
import { Prism } from "prism-react-renderer";
import { FileCode2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { detectLanguage } from "../file-read/detect-language";

export interface DiffCounts {
  additions: number;
  deletions: number;
}

const MAX_HIGHLIGHT_CHARS = 250_000;
const MAX_HIGHLIGHT_LINES = 2_500;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 2_000;

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

const DIFF_VIEWER_STYLES: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: "transparent",
      diffViewerColor: "var(--foreground)",
      addedBackground: "color-mix(in oklab, var(--success) 10%, transparent)",
      addedColor: "var(--foreground)",
      removedBackground: "color-mix(in oklab, var(--destructive) 10%, transparent)",
      removedColor: "var(--foreground)",
      wordAddedBackground: "color-mix(in oklab, var(--success) 30%, transparent)",
      wordRemovedBackground: "color-mix(in oklab, var(--destructive) 30%, transparent)",
      addedGutterBackground: "color-mix(in oklab, var(--success) 10%, transparent)",
      removedGutterBackground: "color-mix(in oklab, var(--destructive) 10%, transparent)",
      gutterBackground: "transparent",
      gutterBackgroundDark: "var(--muted)",
      gutterColor: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
      addedGutterColor: "var(--success)",
      removedGutterColor: "var(--destructive)",
      emptyLineBackground: "transparent",
      codeFoldBackground: "var(--muted)",
      codeFoldGutterBackground: "var(--muted)",
      codeFoldContentColor: "var(--muted-foreground)",
    },
    dark: {
      diffViewerBackground: "transparent",
      diffViewerColor: "var(--foreground)",
      addedBackground: "color-mix(in oklab, var(--success) 10%, transparent)",
      addedColor: "var(--foreground)",
      removedBackground: "color-mix(in oklab, var(--destructive) 10%, transparent)",
      removedColor: "var(--foreground)",
      wordAddedBackground: "color-mix(in oklab, var(--success) 30%, transparent)",
      wordRemovedBackground: "color-mix(in oklab, var(--destructive) 30%, transparent)",
      addedGutterBackground: "color-mix(in oklab, var(--success) 10%, transparent)",
      removedGutterBackground: "color-mix(in oklab, var(--destructive) 10%, transparent)",
      gutterBackground: "transparent",
      gutterBackgroundDark: "var(--muted)",
      gutterColor: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
      addedGutterColor: "var(--success)",
      removedGutterColor: "var(--destructive)",
      emptyLineBackground: "transparent",
      codeFoldBackground: "var(--muted)",
      codeFoldGutterBackground: "var(--muted)",
      codeFoldContentColor: "var(--muted-foreground)",
    },
  },
  diffContainer: {
    minWidth: "unset",
    fontSize: "0.75rem",
    tableLayout: "auto",
  },
  gutter: {
    minWidth: "3.25rem",
    width: "3.25rem",
    padding: "0 0.5rem",
  },
  lineNumber: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    lineHeight: "1.25rem",
    textAlign: "right",
  },
  marker: {
    width: "1.25rem",
    paddingLeft: 0,
    paddingRight: 0,
    textAlign: "center",
  },
  content: {
    width: "100%",
  },
  contentText: {
    color: "var(--foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    lineHeight: "1.25rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  wordAdded: {
    borderRadius: "0.125rem",
  },
  wordRemoved: {
    borderRadius: "0.125rem",
  },
  codeFold: {
    fontWeight: 400,
  },
};

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
  const renderContent = useCallback(
    (source: string) => highlightLine(source, language),
    [language],
  );

  return (
    <ReactDiffViewer
      oldValue={oldContent}
      newValue={newContent}
      splitView={false}
      showDiffOnly={false}
      compareMethod={DiffMethod.WORDS_WITH_SPACE}
      renderContent={highlight ? renderContent : undefined}
      hideSummary
      styles={DIFF_VIEWER_STYLES}
    />
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
          <div data-testid="diff-body" className="max-h-[32rem] overflow-auto">
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
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-foreground">{headerLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DiffStats additions={counts.additions} deletions={counts.deletions} />
        </div>
      </div>
      {hasContent ? (
        <div data-testid="diff-body" className="max-h-[32rem] overflow-auto">
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
