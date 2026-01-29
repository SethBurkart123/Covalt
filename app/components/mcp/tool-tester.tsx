"use client";

import { useState, useCallback, useMemo } from "react";
import { Play, Loader2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { SchemaFormField } from "./schema-form-field";
import type { MCPToolInfo } from "@/python/api";

interface ToolTesterProps {
  tool: MCPToolInfo;
  serverId: string;
  onTest: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ success: boolean; result?: string; error?: string; durationMs?: number }>;
}

type ViewMode = "preview" | "raw";

interface SchemaProperties {
  [key: string]: {
    type?: string | string[];
    description?: string;
    default?: unknown;
  };
}

function getTypeLabel(type: string | string[] | undefined): string {
  if (!type) return "string";
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    return nonNull.join(" | ") || "string";
  }
  return type;
}

export function ToolTester({ tool, serverId, onTest }: ToolTesterProps) {
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [response, setResponse] = useState<{
    success: boolean;
    result?: string;
    error?: string;
    durationMs?: number;
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  const schema = tool.inputSchema as {
    properties?: SchemaProperties;
    required?: string[];
  } | undefined;


  const handleArgChange = useCallback((name: string, value: unknown) => {
    setArgs((prev) => {
      if (value === undefined || value === "") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [name]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [name]: value };
    });
  }, []);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResponse(null);
    const result = await onTest(serverId, tool.name || tool.id.split(":").pop() || tool.id, args);
    setResponse(result);
    setIsRunning(false);
  }, [serverId, tool.id, tool.name, args, onTest]);

  const formattedResponse = useMemo(() => {
    if (!response) return null;
    if (!response.success) return response.error || "Unknown error";
    try {
      return JSON.stringify(JSON.parse(response.result || ""), null, 2);
    } catch {
      return response.result || "";
    }
  }, [response]);

  return (
    <ResizablePanelGroup orientation="vertical" className="flex flex-col h-full">
      <ResizablePanel defaultSize="75%" minSize="10%">
        <div className="overflow-y-auto h-full flex flex-col">
          <div className="px-6 py-4 flex-shrink-0">
            <h2 className="text-xl font-semibold">{tool.name || tool.id.split(":").pop() || tool.id}</h2>
            {tool.description && (
              <div className="mt-2">
                <p
                  className={cn(
                    "text-sm text-muted-foreground",
                    !isDescExpanded && "line-clamp-2"
                  )}
                >
                  {tool.description}
                </p>
                {tool.description.length > 150 && (
                  <button
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
                  >
                    {isDescExpanded ? (
                      <>
                        <ChevronUp className="size-3" /> Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3" /> Show more
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {Object.keys(schema?.properties || {}).length > 0 ? (
            <div className="flex flex-col flex-1">
              <div className="px-6 py-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Arguments
                </h3>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left font-medium text-muted-foreground px-4 py-2">
                          Name
                        </th>
                        <th className="text-left font-medium text-muted-foreground px-4 py-2 w-24">
                          Type
                        </th>
                        <th className="text-left font-medium text-muted-foreground px-4 py-2">
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(schema?.properties || {}).map(([name, propSchema], idx) => (
                        <tr
                          key={name}
                          className={cn(idx !== Object.keys(schema?.properties || {}).length - 1 && "border-b border-border")}
                        >
                          <td className="px-4 py-2.5 font-mono text-sm">
                            {name}
                            {(schema?.required || []).includes(name) && (
                              <span className="text-red-500 ml-0.5">*</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {getTypeLabel(propSchema.type)}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {propSchema.description || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="px-6 py-4 flex-1">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Test Tool
                </h3>
                <div className="grid gap-4">
                  {Object.entries(schema?.properties || {}).map(([name, propSchema]) => (
                    <div key={name} className="space-y-1.5">
                      <label className="text-sm font-medium flex items-center gap-1">
                        <span className="font-mono">{name}</span>
                        {(schema?.required || []).includes(name) && <span className="text-red-500">*</span>}
                      </label>
                      <SchemaFormField
                        name={name}
                        schema={propSchema}
                        value={args[name]}
                        onChange={handleArgChange}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
              This tool has no parameters
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize="25%" minSize="15%">
        <div className="border-t border-border bg-muted/30 h-full flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Response</span>
              {response?.durationMs !== undefined && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" />
                  {response.durationMs}ms
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex bg-muted rounded-[12px] p-0.5">
                <button
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors",
                    viewMode === "preview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Preview
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors",
                    viewMode === "raw"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Raw
                </button>
              </div>

              <Button
                size="sm"
                onClick={handleRun}
                disabled={isRunning}
                className="gap-1.5"
              >
                {isRunning ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {isRunning ? "Running..." : "Run"}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {response ? (
              <pre
                className={cn(
                  "p-4 text-xs font-mono whitespace-pre-wrap break-words",
                  !response.success && "text-red-500"
                )}
              >
                {viewMode === "raw" ? response.result || response.error : formattedResponse}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Click "Run" to test this tool
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
