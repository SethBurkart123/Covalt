"use client";

import { useState, useCallback, useEffect, useRef, type MouseEvent } from "react";
import {
  RefreshCw,
  Plug,
  Pencil,
  Trash2,
  CheckCircle2,
  Loader2,
  XCircle,
  AlertCircle,
  ChevronRight,
  KeyRound,
  LogOut,
} from "lucide-react";
import type { McpServerStatus } from "@/contexts/tools-context";
import {
  reconnectMcpServer,
  startMcpOauth,
  getMcpOauthStatus,
  revokeMcpOauth,
} from "@/python/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusConfig } from "@/components/ui/status-badge";
import { McpErrorHover } from "./mcp-error-display";

const STATUS_CONFIG: Record<McpServerStatus["status"], StatusConfig> = {
  connected: {
    icon: CheckCircle2,
    label: "Connected",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  connecting: {
    icon: Loader2,
    label: "Connecting",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  error: {
    icon: XCircle,
    label: "Error",
    className: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  disconnected: {
    icon: AlertCircle,
    label: "Disconnected",
    className: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  },
  requires_auth: {
    icon: KeyRound,
    label: "Needs Auth",
    className: "bg-primary/10 text-primary border-primary/20",
  },
};

interface McpServerCardProps {
  server: McpServerStatus;
  label?: string;
  toolCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  onInspect: () => void;
}

export function McpServerCard({
  server,
  label,
  toolCount,
  onEdit,
  onDelete,
  onInspect,
}: McpServerCardProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
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

  const pollOauthStatus = useCallback(async () => {
    try {
      const status = await getMcpOauthStatus({ body: { id: server.id } });
      if (status.status === "authenticated") {
        stopPolling();
        await reconnectMcpServer({ body: { id: server.id } });
        setIsAuthenticating(false);
      } else if (status.status === "error") {
        stopPolling();
        setIsAuthenticating(false);
      }
    } catch (error) {
      stopPolling();
      setIsAuthenticating(false);
      console.error("OAuth status polling failed:", error);
    }
  }, [server.id, stopPolling]);

  const handleReconnect = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setIsReconnecting(true);
      try {
        await reconnectMcpServer({ body: { id: server.id } });
      } catch (error) {
        console.error("Failed to reconnect:", error);
      } finally {
        setIsReconnecting(false);
      }
    },
    [server.id]
  );

  const handleAuthenticate = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const serverUrl = server.config?.url;
      if (!serverUrl) return;

      setIsAuthenticating(true);
      stopPolling();

      try {
        const result = await startMcpOauth({
          body: { serverId: server.id, serverUrl },
        });

        if (!result.success || !result.authUrl) {
          setIsAuthenticating(false);
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
          void pollOauthStatus();
        }, 2000);

        pollTimeoutRef.current = setTimeout(() => {
          stopPolling();
          setIsAuthenticating(false);
        }, 5 * 60 * 1000);
      } catch (error) {
        console.error("Failed to start OAuth:", error);
        setIsAuthenticating(false);
      }
    },
    [server.id, server.config?.url, pollOauthStatus, stopPolling]
  );

  const handleRevoke = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setIsRevoking(true);
      try {
        await revokeMcpOauth({ body: { id: server.id } });
        await reconnectMcpServer({ body: { id: server.id } });
      } catch (error) {
        console.error("Failed to revoke OAuth:", error);
      } finally {
        setIsRevoking(false);
      }
    },
    [server.id]
  );

  const showReconnectButton =
    server.status === "error" || server.status === "disconnected";
  const showAuthButton =
    server.status === "requires_auth" && server.authHint !== "token";
  const showConfigureHeadersHint =
    server.status === "requires_auth" && server.authHint === "token";
  const showRevokeButton =
    server.oauthStatus === "authenticated" && server.status === "connected";
  const serverId = server.serverId ?? server.id;
  const displayName = label ?? serverId;
  const showId = displayName !== serverId;



  return (
    <div
      onClick={onInspect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect();
        }
      }}
      className={cn(
        "w-full text-left rounded-lg border border-border bg-card",
        "transition-all hover:bg-muted/50 hover:border-border/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center justify-center size-9 rounded-lg",
              server.status === "connected"
                ? "bg-emerald-500/10"
                : server.status === "error"
                  ? "bg-red-500/10"
                  : "bg-muted"
            )}
          >
            <Plug
              className={cn(
                "size-4",
                server.status === "connected"
                  ? "text-emerald-500"
                  : server.status === "error"
                    ? "text-red-500"
                    : "text-muted-foreground"
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{displayName}</span>
              <StatusBadge
                config={STATUS_CONFIG[server.status]}
                animate={server.status === "connecting"}
              />
            </div>
            {showId && (
              <p className="text-xs text-muted-foreground mt-0.5">
                ID: {serverId}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {server.status === "connected"
                ? `${toolCount ?? server.toolCount ?? 0} tool${(toolCount ?? server.toolCount ?? 0) !== 1 ? "s" : ""}`
                : server.status === "connecting"
                  ? "Connecting..."
                  : server.status === "requires_auth"
                    ? showConfigureHeadersHint
                      ? `Requires API token - configure headers${server.oauthProviderName ? ` for ${server.oauthProviderName}` : ""}`
                      : `Authenticate${server.oauthProviderName ? ` with ${server.oauthProviderName}` : ""} to connect`
                    : server.error
                      ? <McpErrorHover error={server.error} />
                      : "Disconnected"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {showConfigureHeadersHint && (
            <Button
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="bg-primary hover:bg-primary"
            >
              <Pencil className="size-3" />
              Configure Headers
            </Button>
          )}
          {showAuthButton && (
            <Button
              variant="default"
              size="sm"
              onClick={handleAuthenticate}
              disabled={isAuthenticating}
              className="bg-primary hover:bg-primary"
            >
              {isAuthenticating ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <KeyRound className="size-3" />
              )}
              {isAuthenticating
                ? "Waiting..."
                : `Authenticate`}
            </Button>
          )}
          {showRevokeButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <LogOut className="size-3" />
              )}
              Disconnect
            </Button>
          )}
          {showReconnectButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReconnect}
              disabled={isReconnecting}
            >
              <RefreshCw
                className={cn("size-3", isReconnecting && "animate-spin")}
              />
              Reconnect
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
          <ChevronRight className="size-4 text-muted-foreground ml-1" />
        </div>
      </div>
    </div>
  );
}
