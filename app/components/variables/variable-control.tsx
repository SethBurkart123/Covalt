
import { memo } from "react";
import type { ControlKindId, VariableOption, VariableSpec } from "@nodes/_variables";
import { TextControl } from "./variable-control-text";
import { NumberControl, SliderControl } from "./variable-control-number";
import { BooleanControl } from "./variable-control-boolean";
import { SelectControl } from "./variable-control-select";
import { SearchableControl } from "./variable-control-searchable";

export const VARIABLE_TRIGGER_CLASS =
  "h-9 justify-between gap-1.5 rounded-xl border-transparent !bg-secondary dark:!bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground shadow-xs hover:!bg-secondary/80 dark:hover:!bg-secondary/80 [&_svg]:text-muted-foreground/80 [&_svg]:opacity-100";

export const VARIABLE_TRIGGER_COMPACT_CLASS = "max-w-[150px] shrink-0";

export interface VariableControlProps {
  spec: VariableSpec;
  value: unknown;
  options: VariableOption[];
  onChange: (value: unknown) => void;
  compact?: boolean;
  loading?: boolean;
  error?: string | null;
}

export const VariableControl = memo(function VariableControl(props: VariableControlProps) {
  const kind: ControlKindId = props.spec.control.kind;
  switch (kind) {
    case "text":
    case "text-area":
      return <TextControl {...props} />;
    case "number":
      return <NumberControl {...props} />;
    case "slider":
      return <SliderControl {...props} />;
    case "boolean":
      return <BooleanControl {...props} />;
    case "select":
      return <SelectControl {...props} />;
    case "searchable":
      return <SearchableControl {...props} />;
  }
});
