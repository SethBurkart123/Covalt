import { ArrowDown, ArrowUp } from "lucide-react";
import type { ComponentRenderer } from "../engine";
import { asString, renderValue } from "./_shared";

export const Metric: ComponentRenderer = ({ props }) => {
  const label = asString(props.label);
  const trend = asString(props.trend);
  const isUp = trend === "up";
  const isDown = trend === "down";

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {isUp ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
            <ArrowUp className="size-3" />
            Up
          </span>
        ) : null}
        {isDown ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <ArrowDown className="size-3" />
            Down
          </span>
        ) : null}
      </div>
      <div className="text-lg font-semibold tracking-tight text-foreground">
        {renderValue(props.value)}
      </div>
    </div>
  );
};
