import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asString, variantToPillClass } from "./_shared";

export const Badge: ComponentRenderer = ({ props }) => {
  const label = asString(props.label) ?? "";
  const variant = asString(props.variant);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        variantToPillClass(variant),
      )}
    >
      {label}
    </span>
  );
};
