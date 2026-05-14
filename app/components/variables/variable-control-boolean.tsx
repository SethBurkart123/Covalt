
import type { VariableControlProps } from "./variable-control";
import { Switch } from "@/components/ui/switch";

export function BooleanControl({ value, onChange, spec, compact }: VariableControlProps) {
  const checked = typeof value === "boolean" ? value : Boolean(spec.default);
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      className={compact ? "h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3" : undefined}
    />
  );
}
