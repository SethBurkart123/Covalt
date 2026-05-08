import type { ComponentRenderer } from "../engine";
import { asString, colorToHex } from "./_shared";

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry === "number" && Number.isFinite(entry)) out.push(entry);
  }
  return out;
}

export const Sparkline: ComponentRenderer = ({ props }) => {
  const data = asNumberArray(props.data);
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 24 - ((value - min) / range) * 24;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <svg
        aria-label="Sparkline"
        className="w-full"
        height={28}
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
      >
        <polyline
          fill="none"
          points={points}
          stroke={colorToHex(asString(props.color))}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
        />
      </svg>
    </div>
  );
};
