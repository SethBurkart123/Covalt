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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function SelectControl({ spec, value, options, onChange, compact, loading }: VariableControlProps) {
  if (spec.control.kind !== "select") return null;

  if (spec.control.multi) {
    return (
      <MultiSelectControl
        spec={spec}
        value={value}
        options={options}
        onChange={onChange}
        compact={compact}
        loading={loading}
      />
    );
  }

  // Radix Select needs string keys; round-trip via index so unknown values work.
  const currentIndex = options.findIndex((opt) => opt.value === value);
  return (
    <Select
      value={currentIndex >= 0 ? String(currentIndex) : ""}
      onValueChange={(raw) => {
        const idx = Number(raw);
        if (Number.isInteger(idx) && options[idx]) onChange(options[idx].value);
      }}
    >
      <SelectTrigger
        className={cn(
          VARIABLE_TRIGGER_CLASS,
          compact ? VARIABLE_TRIGGER_COMPACT_CLASS : "w-full"
        )}
      >
        <SelectValue placeholder={loading ? "Loading…" : spec.label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, index) => (
          <SelectItem key={`${spec.id}:${index}`} value={String(index)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiSelectControl({ spec, value, options, onChange, compact, loading }: VariableControlProps) {
  const pickerOptions = useMemo<SearchablePickerOption[]>(
    () => options.map((option) => ({ value: option.value, label: option.label })),
    [options]
  );
  return (
    <SearchablePicker
      options={pickerOptions}
      value={value}
      onChange={onChange}
      multi
      placeholder={loading ? "Loading…" : spec.label}
      searchPlaceholder={`Search ${spec.label.toLowerCase()}…`}
      triggerClassName={cn(
        VARIABLE_TRIGGER_CLASS,
        compact ? VARIABLE_TRIGGER_COMPACT_CLASS : "w-full"
      )}
    />
  );
}
