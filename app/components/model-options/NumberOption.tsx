"use client";

import type { OptionDefinition } from "@/lib/types/chat";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NumberOptionProps {
  definition: OptionDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  showLabelTooltip?: boolean;
}

export function NumberOption({
  definition,
  value,
  onChange,
  compact = false,
  showLabelTooltip = false,
}: NumberOptionProps) {
  const min = definition.min;
  const max = definition.max;
  const step = definition.step;
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof definition.default === "number"
        ? definition.default
        : 0;

  const control = (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={numericValue}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === "" ? definition.default : Number(raw));
      }}
      className={compact ? "h-8 w-28" : "h-9"}
    />
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
