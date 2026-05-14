
import type { VariableSpec } from "@nodes/_variables";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FieldLabel } from "./shared";

interface Props {
  spec: VariableSpec;
  onChange: (spec: VariableSpec) => void;
}

export function ControlSpecificFields({ spec, onChange }: Props) {
  const control = spec.control;

  if (control.kind === "slider") {
    return (
      <div className="grid grid-cols-3 gap-2">
        <FieldLabel label="Min">
          <NumericInput
            value={control.min}
            onChange={(min) =>
              onChange({ ...spec, control: { ...control, min: min ?? 0 } })
            }
          />
        </FieldLabel>
        <FieldLabel label="Max">
          <NumericInput
            value={control.max}
            onChange={(max) =>
              onChange({ ...spec, control: { ...control, max: max ?? 1 } })
            }
          />
        </FieldLabel>
        <FieldLabel label="Step">
          <NumericInput
            value={control.step}
            onChange={(step) =>
              onChange({ ...spec, control: { ...control, step } })
            }
          />
        </FieldLabel>
      </div>
    );
  }

  if (control.kind === "number") {
    return (
      <div className="grid grid-cols-3 gap-2">
        <FieldLabel label="Min">
          <NumericInput
            value={control.min}
            onChange={(min) =>
              onChange({ ...spec, control: { ...control, min } })
            }
          />
        </FieldLabel>
        <FieldLabel label="Max">
          <NumericInput
            value={control.max}
            onChange={(max) =>
              onChange({ ...spec, control: { ...control, max } })
            }
          />
        </FieldLabel>
        <FieldLabel label="Step">
          <NumericInput
            value={control.step}
            onChange={(step) =>
              onChange({ ...spec, control: { ...control, step } })
            }
          />
        </FieldLabel>
      </div>
    );
  }

  if (control.kind === "text-area") {
    return (
      <FieldLabel label="Rows">
        <NumericInput
          value={control.rows}
          onChange={(rows) =>
            onChange({ ...spec, control: { ...control, rows } })
          }
        />
      </FieldLabel>
    );
  }

  if (control.kind === "select" || control.kind === "searchable") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={Boolean(control.multi)}
          onCheckedChange={(checked) =>
            onChange({ ...spec, control: { ...control, multi: checked } })
          }
        />
        <span className="text-xs text-muted-foreground">Allow multiple</span>
      </div>
    );
  }

  return null;
}

function NumericInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Input
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      className="h-7 text-xs"
    />
  );
}
