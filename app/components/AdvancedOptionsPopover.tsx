"use client";

import { Settings2 } from "lucide-react";

import type { OptionSchema } from "@/lib/types/chat";
import { isOptionVisible } from "@/lib/hooks/use-model-options";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelOptionControl } from "@/components/model-options";

interface AdvancedOptionsPopoverProps {
  schema: OptionSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
  disabled?: boolean;
}

export default function AdvancedOptionsPopover({
  schema,
  values,
  onChange,
  onReset,
  disabled = false,
}: AdvancedOptionsPopoverProps) {
  if (!schema.advanced.length) return null;

  const visibleAdvancedOptions = schema.advanced.filter((definition) =>
    isOptionVisible(definition, values),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9 flex-shrink-0 rounded-full p-2"
          disabled={disabled}
          aria-label="Advanced model options"
        >
          <Settings2 className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-4">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Advanced Options</h3>

          {visibleAdvancedOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No advanced options available.</p>
          ) : (
            visibleAdvancedOptions.map((definition) => (
              <div key={definition.key} className="space-y-2">
                <Label>{definition.label}</Label>
                <ModelOptionControl
                  definition={definition}
                  value={values[definition.key]}
                  onChange={(nextValue) => onChange(definition.key, nextValue)}
                />
              </div>
            ))
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onReset}
          >
            Reset to Defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
