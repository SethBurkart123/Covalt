"use client";

import { useState } from "react";
import {
  Wrench,
  RefreshCw,
  Plug,
  Pencil,
  Trash2,
  CheckCircle2,
  Loader2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import type { McpServerStatus } from "@/contexts/tools-context";
import { reconnectMcpServer } from "@/python/api";
import type { ToolInfo } from "@/lib/types/chat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusConfig } from "@/components/ui/status-badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

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
  tools: ToolInfo[];
  onEdit: () => void;
  onDelete: () => void;
}

export function McpServerCard({
  server,
  tools,
  onEdit,
  onDelete,
}: McpServerCardProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleReconnect = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setIsReconnecting(true);
    try {
      await reconnectMcpServer({ body: { id: server.id } });
    } catch (error) {
      console.error("Failed to reconnect:", error);
    } finally {
      setIsReconnecting(false);
    }
  };

  const showReconnectButton =
    server.status === "error" || server.status === "disconnected";

  const toolCount = server.toolCount ?? tools.length;
  const hasTools = server.status === "connected" && tools.length > 0;

  return (
    <Collapsible defaultOpen={false} disableToggle={!hasTools}>
      <CollapsibleTrigger
        rightContent={
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
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
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        }
      >
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
          <div className="text-left">
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
      </CollapsibleTrigger>

      {hasTools && (
        <CollapsibleContent>
          <div className="space-y-2">
            {tools.map((tool) => (
              <div
                key={tool.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <Wrench className="size-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {tool.name || tool.id.split(":").pop()}
                  </p>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {tool.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
