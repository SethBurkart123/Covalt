"use client";

import { useState, useCallback, type MouseEvent } from "react";
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
} from "lucide-react";
import type { McpServerStatus } from "@/contexts/tools-context";
import { reconnectMcpServer } from "@/python/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusConfig } from "@/components/ui/status-badge";

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
};

interface McpServerCardProps {
  server: McpServerStatus;
  toolCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  onInspect: () => void;
}

export function McpServerCard({
  server,
  toolCount: toolCountProp,
  onEdit,
  onDelete,
  onInspect,
}: McpServerCardProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

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

  const showReconnectButton =
    server.status === "error" || server.status === "disconnected";

  const toolCount = toolCountProp ?? server.toolCount ?? 0;

  return (
    <button
      onClick={onInspect}
      className={cn(
        "w-full text-left rounded-lg border border-border bg-card",
        "transition-all hover:bg-muted/50 hover:border-border/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              <span className="font-medium">{server.id}</span>
              <StatusBadge
                config={STATUS_CONFIG[server.status]}
                animate={server.status === "connecting"}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {server.status === "connected"
                ? `${toolCount} tool${toolCount !== 1 ? "s" : ""}`
                : server.status === "connecting"
                  ? "Connecting..."
                  : server.error
                    ? server.error
                    : "Disconnected"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
    </button>
  );
}
