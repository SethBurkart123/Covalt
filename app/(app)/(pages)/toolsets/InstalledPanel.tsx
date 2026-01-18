"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ChangeEvent } from "react";
import {
  Package,
  Wrench,
  Loader2,
  Upload,
  Download,
  Power,
  PowerOff,
  Trash2,
  Server,
  Plug,
} from "lucide-react";
import {
  listToolsets,
  getToolset,
  enableToolset,
  uninstallToolset,
  exportToolset,
  importToolset,
  getMcpServers,
  reconnectMcpServer,
  testMcpTool,
  type ToolsetInfo,
  type ToolInfo,
  type MCPToolInfo,
} from "@/python/api";
import { useTools } from "@/contexts/tools-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { McpServerCard, McpServerInspectorDialog } from "@/components/mcp";
import type { ToolInfo as ChatToolInfo } from "@/lib/types/chat";

function ToolCard({ tool }: { tool: ToolInfo }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <Wrench className="size-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {tool.name || tool.id?.split(":").pop()}
        </p>
        {tool.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {tool.description}
          </p>
        )}
      </div>
    </div>
  );
}

interface ToolsetCardProps {
  toolset: ToolsetInfo;
  onToggle: () => void;
  onExport: () => void;
  onUninstall: () => void;
  isToggling: boolean;
}

function ToolsetCard({
  toolset,
  onToggle,
  onExport,
  onUninstall,
  isToggling,
}: ToolsetCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    if (!open) {
      setIsOpen(false);
      return;
    }

    if (tools.length === 0) {
      setIsLoadingTools(true);
      try {
        const detail = await getToolset({ body: { id: toolset.id } });
        setTools(detail.tools || []);
      } catch (err) {
        console.error("Failed to load toolset tools:", err);
      } finally {
        setIsLoadingTools(false);
      }
    }

    setIsOpen(true);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        rightContent={
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              disabled={isToggling}
              title={toolset.enabled ? "Disable" : "Enable"}
            >
              {isToggling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : toolset.enabled ? (
                <Power className="size-4 text-emerald-500" />
              ) : (
                <PowerOff className="size-4 text-muted-foreground" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onExport} title="Export">
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onUninstall}
              className="text-destructive hover:text-destructive"
              title="Uninstall"
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
              toolset.enabled ? "bg-emerald-500/10" : "bg-muted"
            )}
          >
            <Package
              className={cn(
                "size-4",
                toolset.enabled ? "text-emerald-500" : "text-muted-foreground"
              )}
            />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-medium">{toolset.name}</span>
              <span className="text-xs text-muted-foreground">
                v{toolset.version}
              </span>
              {!toolset.enabled && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  Disabled
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {toolset.description || `${toolset.toolCount || 0} tools`}
            </p>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {isLoadingTools ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : tools.length > 0 ? (
          <div className="space-y-2">
            {tools.map((tool, index) => (
              <ToolCard key={tool.id ?? `tool-${index}`} tool={tool} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            No tools in this toolset
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface UninstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolset: ToolsetInfo | null;
  onConfirm: () => void;
  isUninstalling: boolean;
}

function UninstallDialog({
  open,
  onOpenChange,
  toolset,
  onConfirm,
  isUninstalling,
}: UninstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Uninstall Toolset</DialogTitle>
          <DialogDescription>
            Are you sure you want to uninstall{" "}
            <span className="font-semibold text-foreground">
              {toolset?.name}
            </span>
            ? This will remove all tools provided by this toolset and cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isUninstalling}
          >
            {isUninstalling && <Loader2 className="size-4 animate-spin" />}
            Uninstall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface InstalledPanelProps {
  onEditServer: (serverId: string) => void;
  onDeleteServer: (serverId: string) => void;
}

export default function InstalledPanel({
  onEditServer,
  onDeleteServer,
}: InstalledPanelProps) {
  const { availableTools, mcpServers, isLoadingTools, refreshTools } = useTools();
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [isLoadingToolsets, setIsLoadingToolsets] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [uninstallingToolset, setUninstallingToolset] = useState<ToolsetInfo | null>(null);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectingServerId, setInspectingServerId] = useState<string | null>(null);
  const [inspectorTools, setInspectorTools] = useState<MCPToolInfo[]>([]);

  const mcpTools = useMemo(() => {
    const byServer: Record<string, ChatToolInfo[]> = {};
    availableTools.forEach((tool) => {
      if (tool.id.startsWith("mcp:")) {
        const serverId = tool.id.split(":")[1];
        if (!byServer[serverId]) byServer[serverId] = [];
        byServer[serverId].push(tool);
      }
    });
    return byServer;
  }, [availableTools]);

  const inspectingServer = useMemo(
    () => mcpServers.find((s) => s.id === inspectingServerId) || null,
    [mcpServers, inspectingServerId]
  );

  const reloadInspectorTools = useCallback(async (serverId: string) => {
    try {
      const response = await getMcpServers();
      const serverInfo = response.servers.find((s) => s.id === serverId);
      setInspectorTools(serverInfo?.tools || []);
    } catch (err) {
      console.error("Failed to load MCP server tools:", err);
      setInspectorTools([]);
    }
  }, []);

  const handleInspectServer = useCallback(async (serverId: string) => {
    setInspectingServerId(serverId);
    setInspectorOpen(true);
    await reloadInspectorTools(serverId);
  }, [reloadInspectorTools]);

  const handleInspectorReconnect = useCallback(async () => {
    if (!inspectingServerId) return;
    await reconnectMcpServer({ body: { id: inspectingServerId } });
    await reloadInspectorTools(inspectingServerId);
  }, [inspectingServerId, reloadInspectorTools]);

  const handleTestTool = useCallback(
    async (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>
    ): Promise<{ success: boolean; result?: string; error?: string; durationMs?: number }> => {
      try {
        const result = await testMcpTool({
          body: { serverId, toolName, arguments: args },
        });
        return result;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const loadToolsets = useCallback(async () => {
    try {
      const response = await listToolsets({ body: { userMcp: false } });
      setToolsets(response.toolsets);
    } catch (err) {
      console.error("Failed to load toolsets:", err);
    } finally {
      setIsLoadingToolsets(false);
    }
  }, []);

  useEffect(() => {
    loadToolsets();
  }, [loadToolsets]);

  const handleToggle = async (toolset: ToolsetInfo) => {
    setTogglingId(toolset.id);
    try {
      await enableToolset({
        body: { id: toolset.id, enabled: !toolset.enabled },
      });
      await loadToolsets();
    } catch (err) {
      console.error("Failed to toggle toolset:", err);
    } finally {
      setTogglingId(null);
    }
  };

  const handleExport = async (toolset: ToolsetInfo) => {
    try {
      const response = await exportToolset({ body: { id: toolset.id } });
      const bytes = Uint8Array.from(atob(response.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = response.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export toolset:", err);
    }
  };

  const handleUninstallClick = (toolset: ToolsetInfo) => {
    setUninstallingToolset(toolset);
    setUninstallDialogOpen(true);
  };

  const handleUninstallConfirm = async () => {
    if (!uninstallingToolset) return;
    setIsUninstalling(true);
    try {
      await uninstallToolset({ body: { id: uninstallingToolset.id } });
      setUninstallDialogOpen(false);
      await loadToolsets();
    } catch (err) {
      console.error("Failed to uninstall toolset:", err);
    } finally {
      setIsUninstalling(false);
      setUninstallingToolset(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      await importToolset({ file }).promise;
      await loadToolsets();
      refreshTools?.();
    } catch (err) {
      console.error("Failed to import toolset:", err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const isLoading = isLoadingTools || isLoadingToolsets;
  const hasNoContent = mcpServers.length === 0 && toolsets.length === 0;

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (hasNoContent) {
      return (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <div className="flex justify-center gap-3 mb-4">
            <div className="flex items-center justify-center size-12 rounded-xl bg-muted">
              <Plug className="size-6 text-muted-foreground" />
            </div>
            <div className="flex items-center justify-center size-12 rounded-xl bg-muted">
              <Package className="size-6 text-muted-foreground" />
            </div>
          </div>
          <h3 className="text-lg font-medium mb-2">No tools installed</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Add MCP servers for external integrations or import toolsets to extend your AI&apos;s capabilities.
          </p>
          <Button onClick={handleImportClick} disabled={isImporting}>
            {isImporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Import Toolset
          </Button>
        </div>
      );
    }

    return (
      <>
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Server className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              MCP Servers
            </h2>
            <span className="text-xs text-muted-foreground">
              ({mcpServers.length})
            </span>
          </div>

          {mcpServers.length > 0 ? (
            <div className="space-y-2">
              {mcpServers.map((server) => (
                <McpServerCard
                  key={server.id}
                  server={server}
                  toolCount={mcpTools[server.id]?.length || 0}
                  onEdit={() => onEditServer(server.id)}
                  onDelete={() => onDeleteServer(server.id)}
                  onInspect={() => handleInspectServer(server.id)}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <Plug className="size-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No MCP servers configured. Click &quot;Add Server&quot; to connect one.
              </p>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Toolsets
              </h2>
              <span className="text-xs text-muted-foreground">
                ({toolsets.length})
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Import
            </Button>
          </div>

          {toolsets.length > 0 ? (
            <div className="space-y-2">
              {toolsets.map((toolset) => (
                <ToolsetCard
                  key={toolset.id}
                  toolset={toolset}
                  onToggle={() => handleToggle(toolset)}
                  onExport={() => handleExport(toolset)}
                  onUninstall={() => handleUninstallClick(toolset)}
                  isToggling={togglingId === toolset.id}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <Package className="size-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mb-3">
                No toolsets installed
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportClick}
                disabled={isImporting}
              >
                {isImporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Import Toolset
              </Button>
            </div>
          )}
        </section>
      </>
    );
  };

  return (
    <div className={cn("space-y-8", hasNoContent && "space-y-6")}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".zip"
        className="hidden"
      />

      {renderContent()}

      <UninstallDialog
        open={uninstallDialogOpen}
        onOpenChange={setUninstallDialogOpen}
        toolset={uninstallingToolset}
        onConfirm={handleUninstallConfirm}
        isUninstalling={isUninstalling}
      />

      <McpServerInspectorDialog
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        server={inspectingServer}
        tools={inspectorTools}
        onEdit={() => {
          if (inspectingServerId) onEditServer(inspectingServerId);
        }}
        onDelete={() => {
          if (inspectingServerId) onDeleteServer(inspectingServerId);
        }}
        onReconnect={handleInspectorReconnect}
        onTestTool={handleTestTool}
      />
    </div>
  );
}
