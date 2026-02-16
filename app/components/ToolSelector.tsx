"use client";

import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Wrench, KeyRound, Settings } from "lucide-react";
import { useTools, type McpServerStatus } from "@/contexts/tools-context";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
import {
  startMcpOauth,
  getMcpOauthStatus,
  reconnectMcpServer,
} from "@/python/api";
import { ServerFormDialog } from "@/components/mcp";

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
            : status === "requires_auth"
              ? "bg-primary"
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
    refreshTools,
  } = useTools();

  const [authenticatingId, setAuthenticatingId] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollOauthStatus = useCallback(async (serverId: string) => {
    try {
      const status = await getMcpOauthStatus({ body: { id: serverId } });
      if (status.status === "authenticated") {
        stopPolling();
        await reconnectMcpServer({ body: { id: serverId } });
        setAuthenticatingId(null);
      } else if (status.status === "error") {
        stopPolling();
        setAuthenticatingId(null);
      }
    } catch (error) {
      stopPolling();
      setAuthenticatingId(null);
      console.error("OAuth status polling failed:", error);
    }
  }, [stopPolling]);

  const handleAuthenticate = useCallback(async (server: McpServerStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const serverUrl = server.config?.url;
    if (!serverUrl) return;

    setAuthenticatingId(server.id);
    stopPolling();

    try {
      const result = await startMcpOauth({
        body: { serverId: server.id, serverUrl },
      });

      if (!result.success || !result.authUrl) {
        setAuthenticatingId(null);
        return;
      }

      const width = 600, height = 800;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      window.open(
        result.authUrl,
        "Authenticate",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      pollIntervalRef.current = setInterval(() => {
        void pollOauthStatus(server.id);
      }, 2000);

      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setAuthenticatingId(null);
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error("Failed to start OAuth:", error);
      setAuthenticatingId(null);
    }
  }, [pollOauthStatus, stopPolling]);

  const mcpStatusMap = useMemo(() => {
    return mcpServers.reduce(
      (acc, s) => ({ ...acc, [s.id]: s }),
      {} as Record<string, McpServerStatus>
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
              const mcpServer = mcpStatusMap[category] || null;
              const mcpStatus = mcpServer?.status || null;
              const isErrorOrLoading = mcpStatus === "error" || mcpStatus === "connecting" || mcpStatus === "disconnected";
              const needsAuth = mcpStatus === "requires_auth";
              const isUnavailable = isErrorOrLoading || needsAuth;
              const activeCount = tools.filter((t) => activeToolIds.includes(t.id)).length;

              // Server needs authentication - show auth button
              if (needsAuth && mcpServer) {
                const isAuthenticating = authenticatingId === mcpServer.id;
                const showOauthButton = mcpServer.authHint !== "token";
                
                return (
                  <DropdownMenuItem
                    key={category}
                    className="gap-2 py-2 cursor-default"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <McpStatusIndicator status={mcpStatus} />
                    <span className="flex-1 truncate">{formatCategoryName(category)}</span>
                    {showOauthButton ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 text-xs px-2"
                        disabled={isAuthenticating}
                        onClick={(e) => handleAuthenticate(mcpServer, e)}
                      >
                        {isAuthenticating ? (
                          <>
                            <Loader2 className="size-3 animate-spin mr-1" />
                            Waiting...
                          </>
                        ) : (
                          <>
                            <KeyRound className="size-3 mr-1" />
                            Authenticate
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 text-xs px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setEditingServerId(mcpServer.id);
                        }}
                      >
                        <Settings className="size-3 mr-1" />
                        Configure
                      </Button>
                    )}
                  </DropdownMenuItem>
                );
              }

              // Server is connecting/errored with no tools
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
                      isUnavailable && "opacity-60 text-muted-foreground"
                    )}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate flex items-center gap-1.5">
                      {formatCategoryName(category)}
                    </span>
                    {tools.length > 0 && activeCount > 0 && (
                      <span className="text-xs text-muted-foreground mr-1">
                        {activeCount}/{tools.length}
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
                      className={cn(isUnavailable && "opacity-50")}
                      onCheckedChange={() => toggleToolset(category)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={isUnavailable}
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

      <ServerFormDialog
        open={!!editingServerId}
        onOpenChange={(open) => !open && setEditingServerId(null)}
        editingServerId={editingServerId}
        onSuccess={refreshTools}
      />
    </DropdownMenu>
  );
});
