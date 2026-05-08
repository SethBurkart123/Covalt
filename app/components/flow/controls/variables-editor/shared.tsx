import type { ReactNode } from "react";
import type {
  ControlKind,
  ControlKindId,
  OptionsSource,
  VariableSpec,
} from "@nodes/_variables";

export const ROOT_CONTAINER = "__root__";

export const CONTROL_KIND_LABELS: Record<ControlKindId, string> = {
  text: "Text",
  "text-area": "Text Area",
  number: "Number",
  slider: "Slider",
  boolean: "Toggle",
  select: "Dropdown",
  searchable: "Searchable",
};

export const SELECTABLE_KINDS: ReadonlySet<ControlKindId> = new Set([
  "select",
  "searchable",
]);

export type OptionsSourceKind = OptionsSource["kind"];

export const OPTIONS_SOURCE_LABELS: Record<OptionsSourceKind, string> = {
  static: "Static",
  link: "Connected",
  callback: "Callback",
};

export function defaultSourceFor(kind: OptionsSourceKind): OptionsSource {
  if (kind === "static") return { kind: "static", options: [] };
  if (kind === "link") return { kind: "link", socketType: "data" };
  return { kind: "callback", load: "" };
}

export function switchControlKind(
  spec: VariableSpec,
  kind: ControlKindId,
): VariableSpec {
  const next: VariableSpec = { ...spec, control: makeControl(kind) };
  if (!SELECTABLE_KINDS.has(kind)) {
    delete next.options;
  } else if (!next.options) {
    next.options = { kind: "static", options: [] };
  }
  return next;
}

export function makeControl(kind: ControlKindId): ControlKind {
  switch (kind) {
    case "text":
      return { kind: "text" };
    case "text-area":
      return { kind: "text-area", rows: 3 };
    case "number":
      return { kind: "number" };
    case "slider":
      return { kind: "slider", min: 0, max: 1, step: 0.01 };
    case "boolean":
      return { kind: "boolean" };
    case "select":
      return { kind: "select" };
    case "searchable":
      return { kind: "searchable" };
  }
}

export function readSpecs(raw: unknown): VariableSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is VariableSpec =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as VariableSpec).id === "string",
  );
}

export function makeEmptySpec(
  existing: VariableSpec[],
  section?: string,
): VariableSpec {
  const taken = new Set(existing.map((spec) => spec.id));
  let suffix = existing.length + 1;
  let id = `var_${suffix}`;
  while (taken.has(id)) {
    suffix += 1;
    id = `var_${suffix}`;
  }
  return {
    id,
    label: `Variable ${suffix}`,
    control: { kind: "text" },
    placement: "header",
    ...(section ? { section } : {}),
  };
}

export function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
