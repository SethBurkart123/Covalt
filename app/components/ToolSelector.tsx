"use client";

import { memo, useMemo } from "react";
import { Loader2, Wrench } from "lucide-react";
import { useTools, type McpServerStatus } from "@/contexts/tools-context";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function formatCategoryName(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function McpStatusIndicator({
  status,
}: {
  status: McpServerStatus["status"];
}) {
  return (
    <div
      className={cn(
        "size-2 rounded-full flex-shrink-0",
        status === "connected"
          ? "bg-emerald-500"
          : status === "connecting"
            ? "bg-amber-500"
            : status === "error"
              ? "bg-red-500"
              : "bg-zinc-500",
        status === "connecting" && "animate-pulse"
      )}
    />
  );
}

interface ToolSelectorProps {
  children: React.ReactNode;
}

export const ToolSelector = memo(function ToolSelector({ children }: ToolSelectorProps) {
  const {
    groupedTools,
    activeToolIds,
    toggleTool,
    toggleToolset,
    isToolsetActive,
    isToolsetPartiallyActive,
    isLoadingTools,
    mcpServers,
  } = useTools();

  const mcpStatusMap = useMemo(() => {
    return mcpServers.reduce(
      (acc, s) => ({ ...acc, [s.id]: s.status }),
      {} as Record<string, McpServerStatus["status"]>
    );
  }, [mcpServers]);

  const categories = useMemo(() => {
    const categorySet = new Set([
      ...Object.keys(groupedTools.byCategory),
      ...mcpServers.map((s) => s.id),
    ]);
    return Array.from(categorySet).sort();
  }, [groupedTools.byCategory, mcpServers]);



  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-xl"
        align="start"
        sideOffset={8}
      >
        <DropdownMenuLabel className="flex items-center gap-2">
          <Wrench className="size-4" />
          Tools
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isLoadingTools ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : groupedTools.ungrouped.length === 0 && categories.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No tools available
          </div>
        ) : (
          <>
            {groupedTools.ungrouped.map((tool) => {
              const isActive = activeToolIds.includes(tool.id);
              return (
                <DropdownMenuItem
                  key={tool.id}
                  className="gap-2 py-2 cursor-pointer"
                  onClick={() => toggleTool(tool.id)}
                >
                  <Switch
                    checked={isActive}
                    onCheckedChange={() => toggleTool(tool.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="flex-1 truncate">{tool.name || tool.id}</span>
                </DropdownMenuItem>
              );
            })}

            {groupedTools.ungrouped.length > 0 && categories.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {categories.map((category) => {
              const tools = groupedTools.byCategory[category] || [];
              const mcpStatus = mcpStatusMap[category] || null;
              const isErrorOrLoading = mcpStatus === "error" || mcpStatus === "connecting" || mcpStatus === "disconnected";

              if (isErrorOrLoading && tools.length === 0) {
                return (
                  <DropdownMenuItem
                    key={category}
                    disabled
                    className={cn(
                      "gap-2 py-2",
                      mcpStatus === "error" && "opacity-60 text-muted-foreground",
                      (mcpStatus === "connecting" || mcpStatus === "disconnected") && "opacity-70"
                    )}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate">{formatCategoryName(category)}</span>
                    <Switch
                      checked={false}
                      disabled
                      className="opacity-50"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuItem>
                );
              }

              return (
                <DropdownMenuSub key={category}>
                  <DropdownMenuSubTrigger 
                    className={cn(
                      "gap-2 py-2",
                      isErrorOrLoading && "opacity-60 text-muted-foreground"
                    )}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate flex items-center gap-1.5">
                      {formatCategoryName(category)}
                    </span>
                    {tools.length > 0 && (
                      <span className="text-xs text-muted-foreground mr-1">
                        {tools.filter((t) => activeToolIds.includes(t.id)).length}/
                        {tools.length}
                      </span>
                    )}
                    <Switch
                      checked={isToolsetActive(category)}
                      data-state={
                        isToolsetPartiallyActive(category)
                          ? "indeterminate"
                          : isToolsetActive(category)
                            ? "checked"
                            : "unchecked"
                      }
                      className={cn(
                        isToolsetPartiallyActive(category) && "opacity-60",
                        isErrorOrLoading && "opacity-50"
                      )}
                      onCheckedChange={() => toggleToolset(category)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={isErrorOrLoading}
                    />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72 max-h-80 overflow-y-auto rounded-xl">
                    {mcpStatus === "error" && (
                      <div className="px-3 py-2 text-xs text-red-500 bg-red-500/5 border-b border-red-500/10">
                        Server disconnected. Reconnect in Tools page.
                      </div>
                    )}
                    {mcpStatus === "connecting" && (
                      <div className="px-3 py-2 text-xs text-amber-500 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2">
                        <Loader2 className="size-3 animate-spin" />
                        Connecting to server...
                      </div>
                    )}
                    {tools.map((tool) => {
                      const isActive = activeToolIds.includes(tool.id);
                      return (
                        <div
                          key={tool.id}
                          className="flex items-start gap-3 px-3 py-2.5 hover:bg-accent rounded-md cursor-pointer"
                          onClick={() => toggleTool(tool.id)}
                        >
                          <Switch
                            checked={isActive}
                            onCheckedChange={() => toggleTool(tool.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {tool.name || tool.id}
                            </div>
                            {tool.description && (
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {tool.description}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
