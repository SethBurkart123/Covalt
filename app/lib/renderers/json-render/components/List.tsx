import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asBool } from "./_shared";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
    else if (typeof entry === "number" || typeof entry === "boolean") out.push(String(entry));
  }
  return out;
}

export const List: ComponentRenderer = ({ props }) => {
  const items = asStringArray(props.items);
  const ordered = asBool(props.ordered) ?? false;
  const className = cn(
    "ml-4 flex list-outside flex-col gap-1.5 text-sm leading-relaxed text-muted-foreground",
    ordered ? "list-decimal" : "list-disc",
  );

  if (ordered) {
    return (
      <ol className={className}>
        {items.map((item, idx) => (
          <li key={`${item}-${idx}`}>{item}</li>
        ))}
      </ol>
    );
  }
  return (
    <ul className={className}>
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`}>{item}</li>
      ))}
    </ul>
  );
};
