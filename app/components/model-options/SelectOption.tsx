"use client";

import { useEffect, useState } from "react";
import type { OptionDefinition } from "@/lib/types/chat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SelectOptionProps {
  definition: OptionDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  showLabelTooltip?: boolean;
}

export function SelectOption({
  definition,
  value,
  onChange,
  compact = false,
  showLabelTooltip = false,
}: SelectOptionProps) {
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const options = definition.options ?? [];
  const selectedIndex = options.findIndex((option) => option.value === value);
  const fallbackIndex = options.findIndex(
    (option) => option.value === definition.default,
  );
  const effectiveIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex;
  const currentValue = effectiveIndex >= 0 ? String(effectiveIndex) : "";

  useEffect(() => {
    if (open) setTooltipOpen(false);
  }, [open]);

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={currentValue}
      onValueChange={(raw) => {
        const nextIndex = Number(raw);
        const option = Number.isInteger(nextIndex) ? options[nextIndex] : undefined;
        if (option) {
          onChange(option.value);
        }
      }}
    >
      {showLabelTooltip ? (
        <Tooltip
          delayDuration={250}
          open={tooltipOpen}
          onOpenChange={(nextOpen) => setTooltipOpen(open ? false : nextOpen)}
        >
          <TooltipTrigger asChild>
            <SelectTrigger
              className={cn(
                "h-9 justify-between gap-1.5 rounded-xl border-transparent !bg-secondary dark:!bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground shadow-xs hover:!bg-secondary/80 dark:hover:!bg-secondary/80 [&_svg]:text-muted-foreground/80 [&_svg]:opacity-100",
                compact ? "max-w-[130px] flex-shrink-0" : "w-full",
              )}
            >
              <SelectValue placeholder={definition.label} />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {definition.label}
          </TooltipContent>
        </Tooltip>
      ) : (
        <SelectTrigger
          className={cn(
            "h-9 justify-between gap-1.5 rounded-xl border-transparent !bg-secondary dark:!bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground shadow-xs hover:!bg-secondary/80 dark:hover:!bg-secondary/80 [&_svg]:text-muted-foreground/80 [&_svg]:opacity-100",
            compact ? "max-w-[130px] flex-shrink-0" : "w-full",
          )}
        >
          <SelectValue placeholder={definition.label} />
        </SelectTrigger>
      )}
      <SelectContent>
        {options.map((option, index) => (
          <SelectItem key={`${definition.key}:${index}`} value={String(index)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
