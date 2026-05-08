"use client";

import { useMemo } from "react";
import {
  VARIABLE_TRIGGER_CLASS,
  VARIABLE_TRIGGER_COMPACT_CLASS,
  type VariableControlProps,
} from "./variable-control";
import {
  SearchablePicker,
  type SearchablePickerOption,
} from "@/components/ui/searchable-picker";
import { cn } from "@/lib/utils";

export function SearchableControl({ spec, value, options, onChange, compact, loading }: VariableControlProps) {
  const pickerOptions = useMemo<SearchablePickerOption[]>(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        group: option.group,
      })),
    [options]
  );
  if (spec.control.kind !== "searchable") return null;
  const grouped = Boolean(spec.control.grouped);
  const multi = Boolean(spec.control.multi);

  return (
    <SearchablePicker
      options={pickerOptions}
      value={value}
      onChange={onChange}
      multi={multi}
      grouped={grouped}
      placeholder={loading ? "Loading…" : spec.label}
      searchPlaceholder={`Search ${spec.label.toLowerCase()}…`}
      triggerClassName={
        compact
          ? cn(VARIABLE_TRIGGER_CLASS, VARIABLE_TRIGGER_COMPACT_CLASS)
          : undefined
      }
    />
  );
}
