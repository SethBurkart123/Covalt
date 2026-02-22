"use client";

import type { OptionDefinition } from "@/lib/types/chat";
import { BooleanOption } from "@/components/model-options/BooleanOption";
import { NumberOption } from "@/components/model-options/NumberOption";
import { SelectOption } from "@/components/model-options/SelectOption";
import { SliderOption } from "@/components/model-options/SliderOption";

interface ModelOptionControlProps {
  definition: OptionDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  showLabelTooltip?: boolean;
}

export function ModelOptionControl({
  definition,
  value,
  onChange,
  compact = false,
  showLabelTooltip = false,
}: ModelOptionControlProps) {
  if (definition.type === "select") {
    return (
      <SelectOption
        definition={definition}
        value={value}
        onChange={onChange}
        compact={compact}
        showLabelTooltip={showLabelTooltip}
      />
    );
  }

  if (definition.type === "slider") {
    return (
      <SliderOption
        definition={definition}
        value={value}
        onChange={onChange}
        compact={compact}
        showLabelTooltip={showLabelTooltip}
      />
    );
  }

  if (definition.type === "number") {
    return (
      <NumberOption
        definition={definition}
        value={value}
        onChange={onChange}
        compact={compact}
        showLabelTooltip={showLabelTooltip}
      />
    );
  }

  return (
    <BooleanOption
      definition={definition}
      value={value}
      onChange={onChange}
      compact={compact}
      showLabelTooltip={showLabelTooltip}
    />
  );
}
