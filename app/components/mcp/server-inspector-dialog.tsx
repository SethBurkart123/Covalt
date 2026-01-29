"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Plug,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  KeyRound,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusConfig } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { ToolList } from "./tool-list";
import { ToolTester } from "./tool-tester";
import { McpErrorDisplay } from "./mcp-error-display";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { McpServerStatus } from "@/contexts/tools-context";
import type { MCPToolInfo } from "@/python/api";

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
    label: "Auth Required",
    className: "bg-primary/10 text-primary border-primary/20",
  },
};

interface McpServerInspectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: McpServerStatus | null;
  tools: MCPToolInfo[];
  onEdit: () => void;
  onDelete: () => void;
  onReconnect: () => Promise<void>;
  onTestTool: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ success: boolean; result?: string; error?: string; durationMs?: number }>;
}

export function McpServerInspectorDialog({
  open,
  onOpenChange,
  server,
  tools,
  onEdit,
  onDelete,
  onReconnect,
  onTestTool,
}: McpServerInspectorDialogProps) {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedToolId(null);
    } else if (tools.length > 0 && !selectedToolId) {
      setSelectedToolId(tools[0].id);
    }
  }, [open, tools, selectedToolId]);

  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setIsReconnecting(false);
    }
  }, [onReconnect]);

  const handleEdit = useCallback(() => {
    onOpenChange(false);
    onEdit();
  }, [onOpenChange, onEdit]);

  const handleDelete = useCallback(() => {
    onOpenChange(false);
    onDelete();
  }, [onOpenChange, onDelete]);

  if (!server) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[90vw] sm:!max-w-[90vw] w-full h-[85vh] p-0 flex flex-col overflow-hidden gap-0 [&>button:last-child]:hidden"
        overlayClose
      >
        <DialogHeader className="px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mt-0.5">
                <DialogTitle className="text-base font-semibold truncate">
                  {server.id}
                </DialogTitle>
                <StatusBadge
                  config={STATUS_CONFIG[server.status]}
                  animate={server.status === "connecting"}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {tools.length} tool{tools.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {server.status === "error" || server.status === "disconnected" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReconnect}
                  disabled={isReconnecting}
                >
                  <RefreshCw
                    className={cn("size-3.5", isReconnecting && "animate-spin")}
                  />
                  Reconnect
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReconnect}
                  disabled={isReconnecting}
                  title="Reload server"
                >
                  <RefreshCw
                    className={cn("size-4", isReconnecting && "animate-spin")}
                  />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={handleEdit} title="Edit server">
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                className="text-destructive hover:text-destructive"
                title="Delete server"
              >
                <Trash2 className="size-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-2 mr-1.5 rounded" />
              <DialogClose asChild>
                <Button variant="ghost" size="icon" title="Close">
                  <X className="size-4" />
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        {server.status === "connected" && tools.length > 0 ? (
          <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
            <ResizablePanel defaultSize="25%" minSize="15%">
              <div className="h-full overflow-auto border-r border-border">
                <ToolList
                  tools={tools}
                  selectedToolId={selectedToolId}
                  onSelectTool={setSelectedToolId}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel defaultSize="75%" minSize="30%">
              {selectedToolId ? (
                <ToolTester
                  tool={tools.find((t) => t.id === selectedToolId)!}
                  serverId={server.id}
                  onTest={onTestTool}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a tool to inspect
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : server.status === "connecting" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <Loader2 className="size-12 text-muted-foreground/50 animate-spin mb-4" />
            <p className="text-lg font-medium">Connecting to server...</p>
            <p className="text-sm text-muted-foreground mt-1">
              Please wait while we establish the connection
            </p>
          </div>
        ) : (server.status === "error" || server.status === "disconnected") && server.error ? (
          <div className="flex-1 flex min-h-0">
            <div className="w-80 flex-shrink-0 flex flex-col items-center justify-center text-center p-8 border-r border-border">
              <Plug className="size-12 text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium">Server not connected</p>
              <p className="text-sm text-muted-foreground mt-1">
                An error occurred while connecting.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleReconnect}
                disabled={isReconnecting}
              >
                <RefreshCw
                  className={cn("size-4", isReconnecting && "animate-spin")}
                />
                Reconnect
              </Button>
            </div>

            <div className="flex-1 p-6 overflow-auto min-w-0">
              <McpErrorDisplay error={server.error} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <Plug className="size-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">
              {server.status === "error" || server.status === "disconnected"
                ? "Server not connected"
                : "No tools available"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {server.status === "error" || server.status === "disconnected"
                ? "The server is disconnected. Click reconnect to try again."
                : "This server doesn't expose any tools"}
            </p>
            {(server.status === "error" || server.status === "disconnected") && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleReconnect}
                disabled={isReconnecting}
              >
                <RefreshCw
                  className={cn("size-4", isReconnecting && "animate-spin")}
                />
                Reconnect
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
