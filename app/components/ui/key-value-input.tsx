"use client";

import { Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface KeyValuePair {
  key: string;
  value: string;
}

interface KeyValueInputProps {
  label: string;
  description?: string;
  values: KeyValuePair[];
  onChange: (values: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueInput({
  label,
  description,
  values,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
}: KeyValueInputProps) {
  const addRow = () => {
    onChange([...values, { key: "", value: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: "key" | "value", val: string) => {
    const updated = [...values];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          {label}{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addRow}
          className="h-7 text-xs"
        >
          <Plus className="size-3" />
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
            <span>Key</span>
            <span>Value</span>
            <span className="w-8" />
          </div>
          {values.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                placeholder={keyPlaceholder}
                value={item.key}
                onChange={(e) => updateRow(index, "key", e.target.value)}
                className="font-mono text-sm"
              />
              <Input
                placeholder={valuePlaceholder}
                value={item.value}
                onChange={(e) => updateRow(index, "value", e.target.value)}
                className="font-mono text-sm"
                type="password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(index)}
                className="size-9 text-muted-foreground hover:text-destructive"
              >
                <Minus className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
