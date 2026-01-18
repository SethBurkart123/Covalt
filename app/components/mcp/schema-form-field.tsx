"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface SchemaFormFieldProps {
  name: string;
  schema: JsonSchemaProperty;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}

function getPrimaryType(type: string | string[] | undefined): string {
  if (!type) return "string";
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    return nonNull[0] || "string";
  }
  return type;
}

export function SchemaFormField({
  name,
  schema,
  value,
  onChange,
}: SchemaFormFieldProps) {
  const type = getPrimaryType(schema.type);
  const placeholder = `Enter ${name}`;
  const [jsonText, setJsonText] = useState("");

  useEffect(() => {
    if (type !== "array" && type !== "object") return;
    setJsonText(value === undefined || value === null ? "" : JSON.stringify(value, null, 2));
  }, [type, value]);

  if (type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <Switch
          id={name}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(name, checked)}
        />
        <span className="text-sm text-muted-foreground">
          {value ? "true" : "false"}
        </span>
      </div>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <Input
        id={name}
        type="number"
        step={type === "integer" ? 1 : "any"}
        value={value !== undefined && value !== null ? String(value) : ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "") {
            onChange(name, undefined);
          } else {
            onChange(name, type === "integer" ? parseInt(val, 10) : parseFloat(val));
          }
        }}
        placeholder={placeholder}
        className="h-9"
      />
    );
  }

  if (type === "array") {
    return (
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">JSON array</span>
        <textarea
          id={name}
          value={jsonText}
          onChange={(e) => {
            const next = e.target.value;
            setJsonText(next);
            if (next.trim() === "") {
              onChange(name, undefined);
              return;
            }
            try {
              onChange(name, JSON.parse(next));
            } catch {
              // Ignore parse errors while typing
            }
          }}
          placeholder={`["item1", "item2"]`}
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
          rows={3}
        />
      </div>
    );
  }

  if (type === "object") {
    return (
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">JSON object</span>
        <textarea
          id={name}
          value={jsonText}
          onChange={(e) => {
            const next = e.target.value;
            setJsonText(next);
            if (next.trim() === "") {
              onChange(name, undefined);
              return;
            }
            try {
              onChange(name, JSON.parse(next));
            } catch {
              // Ignore parse errors while typing
            }
          }}
          placeholder={`{"key": "value"}`}
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
          rows={3}
        />
      </div>
    );
  }

  return (
    <Input
      id={name}
      type="text"
      value={value !== undefined && value !== null ? String(value) : ""}
      onChange={(e) => onChange(name, e.target.value || undefined)}
      placeholder={placeholder}
      className="h-9"
    />
  );
}
