"use client";

interface ArgumentsDisplayProps {
  args: Record<string, unknown>;
  editableArgs?: string[] | boolean;
  editedValues?: Record<string, unknown>;
  onValueChange?: (key: string, value: unknown) => void;
}

export function ArgumentsDisplay({
  args,
  editableArgs,
  editedValues,
  onValueChange,
}: ArgumentsDisplayProps) {
  const isEditable = (key: string) => {
    if (!editableArgs || !onValueChange) return false;
    if (editableArgs === true) return true;
    return Array.isArray(editableArgs) && editableArgs.includes(key);
  };

  return (
    <div className="space-y-2">
      {Object.entries(args).map(([key, value]) => {
        const editable = isEditable(key);
        const displayValue = editedValues?.[key] ?? value;
        const isMultiline = typeof displayValue === "string" && displayValue.includes("\n");

        return (
          <div key={key}>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {key} <span className="italic opacity-50">{editable && "(editable)"}</span>
            </div>
            {editable && onValueChange ? (
              isMultiline ? (
                <textarea
                  className="w-full text-sm bg-background/15 px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[80px]"
                  value={typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue, null, 2)}
                  onChange={(e) => onValueChange(key, e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="w-full text-sm bg-background/15 px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  value={typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue)}
                  onChange={(e) => onValueChange(key, e.target.value)}
                />
              )
            ) : (
              <div className="w-full bg-background/5 text-sm px-3 py-2 rounded border border-border">
                {typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue, null, 2)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
