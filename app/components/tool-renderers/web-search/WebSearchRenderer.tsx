
import { useMemo, useState, type ReactNode } from "react";
import { Globe, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

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
  toolResult: unknown,
): WebSearchResult[] | undefined {
  if (config?.results) {
    const fromConfig = coerceResults(config.results);
    if (fromConfig) return fromConfig;
  }
  if (typeof toolResult === "string") {
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
  if (toolResult && typeof toolResult === "object") {
    const obj = toolResult as Record<string, unknown>;
    const fromResults = coerceResults(obj.results);
    if (fromResults) return fromResults;
    const fromTop = coerceResults(toolResult);
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

function ResultCard({ result, index }: ResultCardProps): ReactNode {
  const domain = deriveDomain(result.url, result.domain);
  return (
    <Card
      className="px-3 py-2 gap-1"
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

function SkeletonCard({ index }: { index: number }): ReactNode {
  return (
    <Card
      className="px-3 py-2 gap-2"
      data-testid={`web-search-skeleton-${index}`}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-full" />
    </Card>
  );
}

export function WebSearchRenderer({
  toolArgs,
  toolResult,
  isCompleted,
  renderPlan,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps): ReactNode {
  const config = renderPlan?.config;
  const query = useMemo(() => extractQuery(config, toolArgs), [config, toolArgs]);
  const results = useMemo(() => extractResults(config, toolResult), [config, toolResult]);
  const headerLabel = query ? `Web search: ${query}` : "Web search";

  const [isOpen, setIsOpen] = useState(false);

  const rightContent = results ? (
    <span className="text-xs text-muted-foreground" data-testid="web-search-count">
      {results.length} {results.length === 1 ? "result" : "results"}
    </span>
  ) : null;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      mode={mode}
      shimmer={!isCompleted && !results}
      data-testid="web-search-renderer"
      data-completed={isCompleted ? "true" : "false"}
      data-toolcall
    >
      <CollapsibleTrigger rightContent={rightContent}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Search} />
          <span className="text-sm font-medium text-foreground truncate min-w-0">
            {headerLabel}
          </span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
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
      </CollapsibleContent>
    </Collapsible>
  );
}

export default WebSearchRenderer;
