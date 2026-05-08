import type { ComponentRenderer } from "../engine";
import { asBool, asNumber, asString, colorToHex } from "./_shared";

interface BarItem {
  label?: string;
  value?: number;
  color?: string;
}

function asBarData(value: unknown): BarItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return {};
    const e = entry as Record<string, unknown>;
    return {
      label: asString(e.label),
      value: asNumber(e.value),
      color: asString(e.color),
    };
  });
}

export const BarChart: ComponentRenderer = ({ props }) => {
  const data = asBarData(props.data);
  const showPercentage = asBool(props.showPercentage) ?? false;
  const total = data.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const maxValue = Math.max(0, ...data.map((item) => item.value ?? 0));

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      {data.map((item, idx) => {
        const value = item.value ?? 0;
        const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const pctOfTotal =
          showPercentage && total > 0 ? ` (${Math.round((value / total) * 100)}%)` : "";
        return (
          <div key={`${item.label ?? "bar"}-${idx}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="font-mono text-muted-foreground">
                {value}
                {pctOfTotal}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: colorToHex(item.color),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
