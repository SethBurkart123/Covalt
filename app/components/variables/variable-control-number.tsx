
import { useCallback } from "react";
import type { VariableControlProps } from "./variable-control";
import { DraggableNumberInput } from "@/components/ui/draggable-number-input";
import { cn } from "@/lib/utils";

export function NumberControl({ spec, value, onChange, compact }: VariableControlProps) {
  const min = spec.control.kind === "number" ? spec.control.min : undefined;
  const max = spec.control.kind === "number" ? spec.control.max : undefined;
  const step = spec.control.kind === "number" ? spec.control.step : undefined;
  const handleChange = useCallback(
    (next: number) => onChange(clamp(next, min, max)),
    [onChange, min, max]
  );
  if (spec.control.kind !== "number") return null;
  const numericValue = toNumber(value, spec.default, min ?? 0);

  return (
    <DraggableNumberInput
      value={numericValue}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      compact={compact}
      className="w-full"
    />
  );
}

export function SliderControl({ spec, value, onChange, compact }: VariableControlProps) {
  if (spec.control.kind !== "slider") return null;
  const numericValue = toNumber(value, spec.default, spec.control.min);
  const min = spec.control.min;
  const max = spec.control.max;
  const step = spec.control.step ?? (max - min) / 100;

  return (
    <div className={cn("flex items-center gap-2", compact ? "min-w-[150px]" : "w-full")}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      <span className="w-12 text-right text-xs text-muted-foreground">{numericValue}</span>
    </div>
  );
}

function toNumber(value: unknown, fallback: unknown, secondary: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return secondary ?? 0;
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let result = value;
  if (typeof min === "number") result = Math.max(min, result);
  if (typeof max === "number") result = Math.min(max, result);
  return result;
}
