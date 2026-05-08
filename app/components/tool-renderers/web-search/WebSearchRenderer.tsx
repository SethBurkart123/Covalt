"use client";

import { Globe, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ToolRendererProps } from "@/lib/renderers/types";
import { cn } from "@/lib/utils";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
  date?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isResultLike(value: unknown): value is WebSearchResult {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.title === "string" && typeof obj.url === "string";
}

function coerceResults(value: unknown): WebSearchResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter(isResultLike);
  return filtered.length === value.length ? filtered : filtered.length > 0 ? filtered : undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractResults(
  config: Record<string, unknown> | undefined,
  toolResult: string | undefined,
): WebSearchResult[] | undefined {
  if (config?.results) {
    const fromConfig = coerceResults(config.results);
    if (fromConfig) return fromConfig;
  }
  if (!toolResult) return undefined;
  const parsed = tryParse(toolResult);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const fromResults = coerceResults(obj.results);
    if (fromResults) return fromResults;
    const fromTop = coerceResults(parsed);
    if (fromTop) return fromTop;
  }
  return undefined;
}

function extractQuery(
  config: Record<string, unknown> | undefined,
  toolArgs: Record<string, unknown> | undefined,
): string | undefined {
  return (
    asString(config?.query)
    ?? asString(toolArgs?.query)
    ?? asString(toolArgs?.q)
    ?? asString(toolArgs?.search)
  );
}

function deriveDomain(url: string, override?: string): string {
  if (override && override.length > 0) return override;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface ResultCardProps {
  result: WebSearchResult;
  index: number;
}

function ResultCard({ result, index }: ResultCardProps): React.ReactElement {
  const domain = deriveDomain(result.url, result.domain);
  return (
    <Card
      className="px-4 py-3 gap-1.5"
      data-testid={`web-search-result-${index}`}
    >
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-foreground hover:underline"
      >
        {result.title}
      </a>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono">
          <Globe className="h-3 w-3" />
          {domain}
        </span>
        {result.date && <span>{result.date}</span>}
      </div>
      {result.snippet && (
        <p className="text-xs text-muted-foreground line-clamp-3">
          {result.snippet}
        </p>
      )}
    </Card>
  );
}

function SkeletonCard({ index }: { index: number }): React.ReactElement {
  return (
    <Card
      className="px-4 py-3 gap-2"
      data-testid={`web-search-skeleton-${index}`}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-full" />
    </Card>
  );
}

export function WebSearchRenderer({
  toolCall,
  config,
}: ToolRendererProps): React.ReactElement {
  const query = extractQuery(config, toolCall.toolArgs);
  const isCompleted = Boolean(toolCall.isCompleted);
  const results = extractResults(config, toolCall.toolResult);
  const headerLabel = query ? `Web search: ${query}` : "Web search";

  return (
    <Card
      className={cn("p-4 gap-3")}
      data-testid="web-search-renderer"
      data-completed={isCompleted ? "true" : "false"}
    >
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {headerLabel}
        </span>
        {results && (
          <span
            className="ml-auto text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground"
            data-testid="web-search-count"
          >
            {results.length} {results.length === 1 ? "result" : "results"}
          </span>
        )}
      </div>

      {!isCompleted && !results && (
        <div className="flex flex-col gap-2" data-testid="web-search-loading">
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
        </div>
      )}

      {isCompleted && (!results || results.length === 0) && (
        <div
          className="text-sm text-muted-foreground"
          data-testid="web-search-empty"
        >
          No results found
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="web-search-results">
          {results.map((r, i) => (
            <ResultCard key={`${r.url}-${i}`} result={r} index={i} />
          ))}
        </div>
      )}
    </Card>
  );
}

export default WebSearchRenderer;
