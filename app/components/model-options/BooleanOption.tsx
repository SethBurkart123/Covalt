"use client";

import type { OptionDefinition } from "@/lib/types/chat";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BooleanOptionProps {
  definition: OptionDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  showLabelTooltip?: boolean;
}

export function BooleanOption({
  definition,
  value,
  onChange,
  compact = false,
  showLabelTooltip = false,
}: BooleanOptionProps) {
  const defaultValue =
    typeof definition.default === "boolean" ? definition.default : false;
  const checked = typeof value === "boolean" ? value : defaultValue;
  const control = (
    <div className={compact ? "flex h-8 items-center" : "flex h-9 items-center"}>
      <Switch checked={checked} onCheckedChange={onChange} />
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
