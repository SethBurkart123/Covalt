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

function getAggregateStatus(
  servers: McpServerStatus[]
): McpServerStatus["status"] | null {
  if (servers.length === 0) return null;
  if (servers.some((s) => s.status === "requires_auth")) return "requires_auth";
  if (servers.some((s) => s.status === "error")) return "error";
  if (servers.some((s) => s.status === "connecting")) return "connecting";
  if (servers.some((s) => s.status === "disconnected")) return "disconnected";
  return "connected";
}

interface ToolSelectorProps {
  children: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export const ToolSelector = memo(function ToolSelector({
  children,
  disabled = false,
  disabledReason,
}: ToolSelectorProps) {
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
  const [editingServerKey, setEditingServerKey] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
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

  const openEditServer = useCallback((server: McpServerStatus) => {
    setEditingServerKey(server.id);
    setEditingServerId(server.serverId ?? server.id);
    setEditingServerName(server.toolsetName ?? server.serverId ?? server.id);
  }, []);

  const serversByToolset = useMemo(() => {
    const map = new Map<string, McpServerStatus[]>();
    mcpServers.forEach((server) => {
      const toolsetId = server.toolsetId;
      if (!toolsetId) return;
      const list = map.get(toolsetId) ?? [];
      list.push(server);
      map.set(toolsetId, list);
    });
    return map;
  }, [mcpServers]);

  const toolsetNameById = useMemo(() => {
    const map: Record<string, string> = { ...groupedTools.toolsetNames };
    mcpServers.forEach((server) => {
      if (server.toolsetId && !map[server.toolsetId]) {
        map[server.toolsetId] = server.toolsetName || server.toolsetId;
      }
    });
    return map;
  }, [groupedTools.toolsetNames, mcpServers]);

  const toolsetIds = useMemo(() => {
    const idSet = new Set([
      ...Object.keys(groupedTools.byToolset),
      ...mcpServers.map((s) => s.toolsetId).filter((id): id is string => !!id),
    ]);
    return Array.from(idSet).sort((a, b) =>
      (toolsetNameById[a] || a).localeCompare(toolsetNameById[b] || b)
    );
  }, [groupedTools.byToolset, mcpServers, toolsetNameById]);



  if (disabled) {
    return (
      <div className="pointer-events-none opacity-60" title={disabledReason}>
        {children}
      </div>
    );
  }

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
        ) : groupedTools.ungrouped.length === 0 && toolsetIds.length === 0 ? (
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

            {groupedTools.ungrouped.length > 0 && toolsetIds.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {toolsetIds.map((toolsetId) => {
              const tools = groupedTools.byToolset[toolsetId] || [];
              const toolsetName = toolsetNameById[toolsetId] || toolsetId;
              const servers = serversByToolset.get(toolsetId) || [];
              const mcpStatus = getAggregateStatus(servers);
              const primaryServer = servers.length === 1 ? servers[0] : null;
              const isErrorOrLoading =
                mcpStatus === "error" ||
                mcpStatus === "connecting" ||
                mcpStatus === "disconnected";
              const needsAuth = mcpStatus === "requires_auth";
              const isUnavailable = (isErrorOrLoading || needsAuth) && tools.length === 0;
              const activeCount = tools.filter((t) => activeToolIds.includes(t.id)).length;

              // Server needs authentication - show auth button
              if (needsAuth && primaryServer && tools.length === 0) {
                const isAuthenticating = authenticatingId === primaryServer.id;
                const showOauthButton = primaryServer.authHint !== "token";
                
                return (
                  <DropdownMenuItem
                    key={toolsetId}
                    className="gap-2 py-2 cursor-default"
                    onSelect={(e) => e.preventDefault()}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate">{toolsetName}</span>
                    {showOauthButton ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 text-xs px-2"
                        disabled={isAuthenticating}
                        onClick={(e) => handleAuthenticate(primaryServer, e)}
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
                          openEditServer(primaryServer);
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
                    key={toolsetId}
                    disabled
                    className={cn(
                      "gap-2 py-2",
                      mcpStatus === "error" && "opacity-60 text-muted-foreground",
                      (mcpStatus === "connecting" || mcpStatus === "disconnected") && "opacity-70"
                    )}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate">{toolsetName}</span>
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
                <DropdownMenuSub key={toolsetId}>
                  <DropdownMenuSubTrigger 
                    className={cn(
                      "gap-2 py-2",
                      isUnavailable && "opacity-60 text-muted-foreground"
                    )}
                  >
                    {mcpStatus && <McpStatusIndicator status={mcpStatus} />}
                    <span className="flex-1 truncate flex items-center gap-1.5">
                      {toolsetName}
                    </span>
                    {tools.length > 0 && activeCount > 0 && (
                      <span className="text-xs text-muted-foreground mr-1">
                        {activeCount}/{tools.length}
                      </span>
                    )}
                    <Switch
                      checked={isToolsetActive(toolsetId)}
                      data-state={
                        isToolsetPartiallyActive(toolsetId)
                          ? "indeterminate"
                          : isToolsetActive(toolsetId)
                            ? "checked"
                            : "unchecked"
                      }
                      className={cn(isUnavailable && "opacity-50")}
                      onCheckedChange={() => toggleToolset(toolsetId)}
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
                          className="flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors rounded-md cursor-pointer"
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
        open={!!editingServerKey}
        onOpenChange={(open) => {
          if (!open) {
            setEditingServerKey(null);
            setEditingServerId(null);
            setEditingServerName(null);
          }
        }}
        editingServerKey={editingServerKey}
        editingServerId={editingServerId}
        editingServerName={editingServerName}
        onSuccess={refreshTools}
      />
    </DropdownMenu>
  );
});
