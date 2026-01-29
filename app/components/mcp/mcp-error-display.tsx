"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const splitLines = (error: string) => error.split("\n").filter((line) => line.trim());

interface McpErrorDisplayProps {
  error: string;
  className?: string;
}

export function McpErrorDisplay({ error, className }: McpErrorDisplayProps) {
  const lines = splitLines(error);

  return (
    <div
      className={cn(
        "rounded-lg border border-red-500/20 bg-red-500/5 p-4",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-500 mb-2">
            Connection Error
          </p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
            {lines.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface McpErrorHoverProps {
  error: string;
  children?: ReactNode;
}

export function McpErrorHover({ error, children }: McpErrorHoverProps) {
  if (splitLines(error).length === 1) {
    return <span className="italic">{error}</span>;
  }

  const lines = splitLines(error);
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className="italic cursor-help">
          {children ?? "Hover to see error"}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-md p-0 bg-popover border border-border shadow-lg [&_svg.arrow]:hidden!"
      >
        <div className="p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-red-500 mb-1.5">
                Connection Error
              </p>
              <pre className="text-xs text-popover-foreground whitespace-pre-wrap break-words font-mono leading-relaxed max-h-64 overflow-y-auto">
                {lines.join("\n")}
              </pre>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
