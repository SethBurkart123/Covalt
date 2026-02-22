"use client";

import type { OptionSchema } from "@/lib/types/chat";
import { isOptionVisible } from "@/lib/hooks/use-model-options";
import { ModelOptionControl } from "@/components/model-options";

interface MainModelOptionsProps {
  schema: OptionSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export default function MainModelOptions({
  schema,
  values,
  onChange,
}: MainModelOptionsProps) {
  if (!schema.main.length) return null;

  const visibleMainOptions = schema.main.filter((definition) =>
    isOptionVisible(definition, values),
  );
  if (!visibleMainOptions.length) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {visibleMainOptions.map((definition) => (
        <div key={definition.key} className="flex-shrink-0">
          <ModelOptionControl
            definition={definition}
            value={values[definition.key]}
            compact
            showLabelTooltip
            onChange={(nextValue) => onChange(definition.key, nextValue)}
          />
        </div>
      ))}
    </div>
  );
}
