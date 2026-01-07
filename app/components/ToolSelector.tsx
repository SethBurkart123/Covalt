"use client";

import React from "react";
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

const CATEGORY_ICONS: Record<string, string> = {
  utility: "🔧",
  search: "🔍",
  other: "📦",
};

function getCategoryIcon(category: string): string {
  const lower = category.toLowerCase();
  if (lower in CATEGORY_ICONS) return CATEGORY_ICONS[lower];
  if (lower.startsWith("mcp:") || lower.includes("server")) return "🔌";
  return "📦";
}

function formatCategoryName(category: string): string {
  if (category.startsWith("mcp:")) {
    return category.slice(4);
  }
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

export const ToolSelector = React.memo(function ToolSelector({ children }: ToolSelectorProps) {
  const {
    toolsByCategory,
    activeToolIds,
    toggleTool,
    toggleToolset,
    isToolsetActive,
    isToolsetPartiallyActive,
    isLoading,
    mcpServers,
  } = useTools();

  const mcpStatusMap = React.useMemo(() => {
    const map: Record<string, McpServerStatus["status"]> = {};
    mcpServers.forEach((s) => {
      map[s.id] = s.status;
    });
    return map;
  }, [mcpServers]);

  const categories = React.useMemo(() => {
    const toolCategories = new Set(Object.keys(toolsByCategory));
    mcpServers.forEach((server) => {
      if (!toolCategories.has(server.id)) {
        toolCategories.add(server.id);
      }
    });
    return Array.from(toolCategories).sort();
  }, [toolsByCategory, mcpServers]);

  const getMcpServerId = (category: string): string | null => {
    if (mcpStatusMap[category]) {
      return category;
    }
    if (category.startsWith("mcp:")) {
      return category.slice(4);
    }
    return null;
  };

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

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : categories.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No tools available
          </div>
        ) : (
          categories.map((category) => {
            const tools = toolsByCategory[category] || [];
            const allActive = isToolsetActive(category);
            const partiallyActive = isToolsetPartiallyActive(category);
            const mcpServerId = getMcpServerId(category);
            const mcpStatus = mcpServerId ? mcpStatusMap[mcpServerId] : null;
            const isErrorOrLoading = mcpStatus === "error" || mcpStatus === "connecting" || mcpStatus === "disconnected";
            const hasTools = tools.length > 0;

            if (isErrorOrLoading && !hasTools) {
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
                  {mcpStatus ? (
                    <McpStatusIndicator status={mcpStatus} />
                  ) : (
                    <span className="text-base leading-none">
                      {getCategoryIcon(category)}
                    </span>
                  )}
                  <span className="flex-1 truncate flex items-center gap-1.5">
                    {formatCategoryName(category)}
                  </span>
                  {hasTools && (
                    <span className="text-xs text-muted-foreground mr-1">
                      {tools.filter((t) => activeToolIds.includes(t.id)).length}/
                      {tools.length}
                    </span>
                  )}
                  <Switch
                    checked={allActive}
                    data-state={
                      partiallyActive
                        ? "indeterminate"
                        : allActive
                          ? "checked"
                          : "unchecked"
                    }
                    className={cn(
                      partiallyActive && "opacity-60",
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
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
