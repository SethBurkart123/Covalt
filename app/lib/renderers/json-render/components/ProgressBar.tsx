import type { ComponentRenderer } from "../engine";
import { asNumber, asString } from "./_shared";

export const ProgressBar: ComponentRenderer = ({ props }) => {
  const raw = asNumber(props.progress) ?? 0;
  const progress = Math.max(0, Math.min(1, raw));
  const width = asNumber(props.width);
  const label = asString(props.label);
  const pct = Math.round(progress * 100);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      {label ? (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="font-mono text-muted-foreground">{pct}%</span>
        </div>
      ) : null}
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        style={{ width: width ? `${width}px` : "100%" }}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};
