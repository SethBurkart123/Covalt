
import { Plus, Trash2 } from "lucide-react";
import type { VariableOption, VariableSpec } from "@nodes/_variables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FieldLabel,
  OPTIONS_SOURCE_LABELS,
  defaultSourceFor,
  type OptionsSourceKind,
} from "./shared";

interface Props {
  spec: VariableSpec;
  onChange: (spec: VariableSpec) => void;
}

export function OptionsSourceFields({ spec, onChange }: Props) {
  const source = spec.options ?? { kind: "static" as const, options: [] };

  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-2 space-y-2">
      <FieldLabel label="Options">
        <Select
          value={source.kind}
          onValueChange={(value) =>
            onChange({
              ...spec,
              options: defaultSourceFor(value as OptionsSourceKind),
            })
          }
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OPTIONS_SOURCE_LABELS).map(([kind, label]) => (
              <SelectItem key={kind} value={kind}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabel>

      {source.kind === "static" && (
        <StaticOptionsEditor
          options={source.options as VariableOption[]}
          onChange={(options) =>
            onChange({ ...spec, options: { kind: "static", options } })
          }
        />
      )}

      {source.kind === "link" && (
        <p className="text-[11px] text-muted-foreground">
          A socket appears on this node — wire any node&apos;s output into it
          to provide options.
        </p>
      )}

      {source.kind === "callback" && (
        <FieldLabel label="Loader id">
          <Input
            value={source.load ?? ""}
            onChange={(e) =>
              onChange({
                ...spec,
                options: { kind: "callback", load: e.target.value },
              })
            }
            placeholder="my_plugin:list_things"
            className="h-7 text-xs"
          />
        </FieldLabel>
      )}
    </div>
  );
}

function StaticOptionsEditor({
  options,
  onChange,
}: {
  options: VariableOption[];
  onChange: (options: VariableOption[]) => void;
}) {
  const update = (index: number, partial: Partial<VariableOption>) => {
    onChange(
      options.map((opt, i) => (i === index ? { ...opt, ...partial } : opt)),
    );
  };

  return (
    <div className="space-y-1.5">
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={String(option.value ?? "")}
            placeholder="value"
            onChange={(e) => update(index, { value: e.target.value })}
            className="h-7 text-xs"
          />
          <Input
            value={option.label}
            placeholder="label"
            onChange={(e) => update(index, { label: e.target.value })}
            className="h-7 text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
            title="Remove option"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-xs h-7"
        onClick={() => onChange([...options, { value: "", label: "" }])}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add option
      </Button>
    </div>
  );
}
