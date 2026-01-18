"use client";

import { memo } from "react";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MCPToolInfo } from "@/python/api";

interface ToolListProps {
  tools: MCPToolInfo[];
  selectedToolId: string | null;
  onSelectTool: (toolId: string) => void;
}

export const ToolList = memo(function ToolList({
  tools,
  selectedToolId,
  onSelectTool,
}: ToolListProps) {
  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Wrench className="size-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No tools available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {tools.map((tool) => {
        const isSelected = tool.id === selectedToolId;
        const displayName = tool.name || tool.id.split(":").pop() || tool.id;

        const shortDesc = tool.description
          ? tool.description.length > 80
            ? `${tool.description.slice(0, 80)}...`
            : tool.description
          : null;

        const schema = tool.inputSchema as
          | { properties?: Record<string, unknown> }
          | undefined;
        const paramCount = schema?.properties ? Object.keys(schema.properties).length : 0;

        return (
          <button
            key={tool.id}
            onClick={() => onSelectTool(tool.id)}
            className={cn(
              "w-full text-left p-3 rounded-lg transition-colors",
              isSelected
                ? "bg-primary/10 border border-primary/30"
                : "border border-transparent hover:bg-muted/80"
            )}
          >
            <div className="flex items-start gap-2">
              <Wrench
                className={cn(
                  "size-4 mt-0.5 flex-shrink-0",
                  isSelected ? "text-primary" : "text-muted-foreground"
                )}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-medium text-sm truncate",
                    isSelected && "text-primary"
                  )}
                >
                  {displayName}
                </p>
                {shortDesc && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {shortDesc}
                  </p>
                )}
                {paramCount > 0 && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {paramCount} parameter{paramCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
});
