import type { ComponentRenderer } from "../engine";
import { asString, renderValue } from "./_shared";

export const KeyValue: ComponentRenderer = ({ props }) => {
  const label = asString(props.label);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{renderValue(props.value)}</span>
    </div>
  );
};
