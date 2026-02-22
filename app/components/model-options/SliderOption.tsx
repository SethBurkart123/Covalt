"use client";

import type { OptionDefinition } from "@/lib/types/chat";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SliderOptionProps {
  definition: OptionDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  showLabelTooltip?: boolean;
}

export function SliderOption({
  definition,
  value,
  onChange,
  compact = false,
  showLabelTooltip = false,
}: SliderOptionProps) {
  const min = definition.min ?? 0;
  const max = definition.max ?? 1;
  const step = definition.step ?? 1;
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof definition.default === "number"
        ? definition.default
        : min;

  const control = (
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
      <span className="w-12 text-right text-xs text-muted-foreground">
        {numericValue}
      </span>
    </div>
  );

  if (!showLabelTooltip) return control;

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {definition.label}
      </TooltipContent>
    </Tooltip>
  );
}
