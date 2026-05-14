
import type { ReactNode } from "react";
import { MoreHorizontal, Settings2 } from "lucide-react";
import type { VariableOption, VariableSpec } from "@nodes/_variables";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { VariableControl } from "./variable-control";

export interface VariablesRuntimeContext {
  values: Record<string, unknown>;
  setValue: (id: string, value: unknown) => void;
  optionsFor: (id: string) => VariableOption[];
  loadingFor: (id: string) => boolean;
}

interface VariablesRuntimeProps {
  specs: VariableSpec[];
  ctx: VariablesRuntimeContext;
}

const MAX_INLINE_HEADER_VARIABLES = 3;

export function VariablesHeader({ specs, ctx }: VariablesRuntimeProps) {
  const visible = specs.filter((spec) => (spec.placement ?? "header") === "header");
  if (visible.length === 0) return null;

  const inline = visible.slice(0, MAX_INLINE_HEADER_VARIABLES);
  const hasOverflow = visible.length > MAX_INLINE_HEADER_VARIABLES;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-2 overflow-visible">
        {inline.map((spec) => (
          <div key={spec.id} className="shrink-0">
            <SpecField spec={spec} ctx={ctx} compact />
          </div>
        ))}
      </div>
      {hasOverflow && (
        <VariablesPopoverShell
          specs={visible}
          ctx={ctx}
          title="Variables"
          ariaLabel="All variables"
          icon={<MoreHorizontal className="size-5" />}
          width="w-[24rem]"
        />
      )}
    </div>
  );
}

export function VariablesAdvancedPopover({
  specs,
  ctx,
  onReset,
}: VariablesRuntimeProps & { onReset?: () => void }) {
  const advanced = specs.filter((spec) => spec.placement === "advanced");
  if (advanced.length === 0) return null;

  return (
    <VariablesPopoverShell
      specs={advanced}
      ctx={ctx}
      title="Advanced"
      ariaLabel="Advanced variables"
      icon={<Settings2 className="size-5" />}
      width="w-[22rem]"
      footer={
        onReset ? (
          <Button type="button" variant="outline" className="mt-4 w-full" onClick={onReset}>
            Reset to Defaults
          </Button>
        ) : null
      }
    />
  );
}

interface VariablesPopoverShellProps extends VariablesRuntimeProps {
  title: string;
  ariaLabel: string;
  icon: ReactNode;
  width: string;
  footer?: ReactNode;
}

function VariablesPopoverShell({
  specs,
  ctx,
  title,
  ariaLabel,
  icon,
  width,
  footer,
}: VariablesPopoverShellProps) {
  const sections = groupBySection(specs);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full p-2"
          aria-label={ariaLabel}
        >
          {icon}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`p-0 ${width}`}>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="mt-4 space-y-5">
            {sections.map((section) => (
              <VariableSection key={section.label ?? "_"} section={section} ctx={ctx} />
            ))}
          </div>
          {footer}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VariableSection({ section, ctx }: { section: SectionGroup; ctx: VariablesRuntimeContext }) {
  return (
    <section className="space-y-2 border-l border-border/70 pl-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {section.label ?? "General"}
      </h4>
      <div className="space-y-3">
        {section.specs.map((spec) => (
          <div key={spec.id} className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{spec.label}</label>
            <SpecField spec={spec} ctx={ctx} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SpecField({ spec, ctx, compact = false }: { spec: VariableSpec; ctx: VariablesRuntimeContext; compact?: boolean }) {
  const control = (
    <VariableControl
      spec={spec}
      value={ctx.values[spec.id]}
      options={ctx.optionsFor(spec.id)}
      loading={ctx.loadingFor(spec.id)}
      onChange={(value) => ctx.setValue(spec.id, value)}
      compact={compact}
    />
  );

  if (!compact) return control;

  return (
    <div className="css-tooltip css-tooltip-top shrink-0">
      {control}
      <span className="css-tooltip-content" aria-hidden="true">
        <span className="css-tooltip-label">{spec.label}</span>
        <span className="css-tooltip-arrow" />
      </span>
    </div>
  );
}

interface SectionGroup {
  label?: string;
  specs: VariableSpec[];
}

function groupBySection(specs: VariableSpec[]): SectionGroup[] {
  const ordered: SectionGroup[] = [];
  const byLabel = new Map<string, SectionGroup>();
  for (const spec of specs) {
    const label = spec.section ?? "";
    let group = byLabel.get(label);
    if (!group) {
      group = { label: label || undefined, specs: [] };
      byLabel.set(label, group);
      ordered.push(group);
    }
    group.specs.push(spec);
  }
  return ordered;
}
