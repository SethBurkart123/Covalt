
import { useCallback } from "react";
import type { VariableControlProps } from "./variable-control";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function TextControl({ spec, value, onChange, compact }: VariableControlProps) {
  const stringValue = typeof value === "string" ? value : "";
  const placeholder = "placeholder" in spec.control ? spec.control.placeholder : undefined;

  const handleChange = useCallback(
    (next: string) => onChange(next),
    [onChange]
  );

  if (spec.control.kind === "text-area") {
    const rows = spec.control.rows ?? 3;
    return (
      <Textarea
        value={stringValue}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        className={compact ? "text-xs" : undefined}
      />
    );
  }

  return (
    <Input
      value={stringValue}
      placeholder={placeholder}
      onChange={(event) => handleChange(event.target.value)}
      className={compact ? "h-8 text-xs" : undefined}
    />
  );
}
