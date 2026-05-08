import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asString, isStatus, statusToDotClass, type Status } from "./_shared";

interface TimelineItem {
  title?: string;
  description?: string;
  status?: Status;
}

function asItems(value: unknown): TimelineItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return {};
    const e = entry as Record<string, unknown>;
    const status = asString(e.status);
    return {
      title: asString(e.title),
      description: asString(e.description),
      status: isStatus(status) ? status : undefined,
    };
  });
}

export const Timeline: ComponentRenderer = ({ props }) => {
  const items = asItems(props.items);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <div key={`timeline-${idx}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn("mt-1 size-2 rounded-full", statusToDotClass(item.status))}
              />
              {!isLast ? <div className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 pb-1">
              <div className="text-xs font-medium text-foreground">{item.title}</div>
              {item.description ? (
                <div className="text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};
