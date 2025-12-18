"use client";

import React from "react";
import { Loader2, Wrench } from "lucide-react";
import { useTools } from "@/contexts/tools-context";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

interface ToolSelectorProps {
  children: React.ReactNode;
}

export function ToolSelector({ children }: ToolSelectorProps) {
  const {
    toolsByCategory,
    activeToolIds,
    toggleTool,
    toggleToolset,
    isToolsetActive,
    isToolsetPartiallyActive,
    isLoading,
  } = useTools();

  const categories = Object.keys(toolsByCategory);

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
            const tools = toolsByCategory[category];
            const allActive = isToolsetActive(category);
            const partiallyActive = isToolsetPartiallyActive(category);

            return (
              <DropdownMenuSub key={category}>
                <DropdownMenuSubTrigger className="gap-2 py-2">
                  <span className="text-base leading-none">
                    {getCategoryIcon(category)}
                  </span>
                  <span className="flex-1 truncate">
                    {formatCategoryName(category)}
                  </span>
                  <span className="text-xs text-muted-foreground mr-1">
                    {tools.filter((t) => activeToolIds.includes(t.id)).length}/
                    {tools.length}
                  </span>
                  <Switch
                    checked={allActive}
                    data-state={
                      partiallyActive
                        ? "indeterminate"
                        : allActive
                          ? "checked"
                          : "unchecked"
                    }
                    className={partiallyActive ? "opacity-60" : ""}
                    onCheckedChange={() => toggleToolset(category)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72 max-h-80 overflow-y-auto rounded-xl">
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
}
