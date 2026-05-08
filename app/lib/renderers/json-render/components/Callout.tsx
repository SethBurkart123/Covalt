import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asString, variantToPillClass } from "./_shared";

const CONTAINER_BY_TYPE: Record<string, string> = {
  warning: "border-amber-500/40 bg-amber-500/5",
  info: "border-sky-500/40 bg-sky-500/5",
  success: "border-emerald-500/40 bg-emerald-500/5",
  error: "border-destructive/40 bg-destructive/5",
  danger: "border-destructive/40 bg-destructive/5",
};

export const Callout: ComponentRenderer = ({ props }) => {
  const type = asString(props.type) ?? "info";
  const title = asString(props.title);
  const content = asString(props.content);
  const containerClass = CONTAINER_BY_TYPE[type] ?? "border-border bg-muted/30";

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3 text-xs", containerClass)}>
      {title ? (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
              variantToPillClass(type),
            )}
          >
            {type}
          </span>
          <span className="font-semibold text-foreground">{title}</span>
        </div>
      ) : null}
      {content ? <div className="text-muted-foreground">{content}</div> : null}
    </div>
  );
};
