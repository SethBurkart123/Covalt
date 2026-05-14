
import { Card } from "@/components/ui/card";
import type { ToolRendererProps } from "@/lib/renderers/types";

export interface KeyValueRow {
  label: string;
  value: unknown;
}

function isRowLike(value: unknown): value is KeyValueRow {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.label === "string" && "value" in obj;
}

function coerceRows(value: unknown): KeyValueRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter(isRowLike);
  return filtered.length > 0 ? filtered : undefined;
}

const RESERVED_KEYS = new Set(["rows", "title"]);

function rowsFromConfig(config: Record<string, unknown> | undefined): KeyValueRow[] {
  if (!config) return [];
  const explicit = coerceRows(config.rows);
  if (explicit) return explicit;
  return Object.entries(config)
    .filter(([key]) => !RESERVED_KEYS.has(key))
    .map(([key, value]) => ({ label: key, value }));
}

function stringifyValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function KeyValueRenderer({
  config,
}: ToolRendererProps): React.ReactElement {
  const title = typeof config?.title === "string" ? config.title : undefined;
  const rows = rowsFromConfig(config);

  return (
    <Card className="p-4 gap-2" data-testid="key-value-renderer">
      {title && (
        <div className="text-sm font-medium text-foreground" data-testid="key-value-title">
          {title}
        </div>
      )}
      {rows.length === 0 ? (
        <div
          className="text-sm text-muted-foreground"
          data-testid="key-value-empty"
        >
          No data
        </div>
      ) : (
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs"
          data-testid="key-value-rows"
        >
          {rows.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              className="contents"
              data-testid={`key-value-row-${i}`}
              data-label={row.label}
            >
              <dt className="font-semibold text-foreground">{row.label}</dt>
              <dd className="font-mono text-muted-foreground break-all whitespace-pre-wrap">
                {stringifyValue(row.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export default KeyValueRenderer;
