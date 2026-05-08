import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asString, isStatus, statusToPillClass, type Status } from "./_shared";

export const StatusLine: ComponentRenderer = ({ props }) => {
  const text = asString(props.text);
  const rawStatus = asString(props.status);
  const status: Status = isStatus(rawStatus) ? rawStatus : "info";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
          statusToPillClass(status),
        )}
      >
        {status}
      </span>
      <span className="font-medium text-foreground">{text}</span>
    </div>
  );
};
