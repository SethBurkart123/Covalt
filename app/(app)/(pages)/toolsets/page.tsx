"use client";

import React from "react";
import {
  Package,
  Wrench,
  Loader2,
  Upload,
  Download,
  Power,
  PowerOff,
  Trash2,
  AlertCircle,
} from "lucide-react";
import {
  listToolsets,
  getToolset,
  enableToolset,
  uninstallToolset,
  exportToolset,
  importToolset,
  type ToolsetInfo,
  type ToolInfo,
} from "@/python/api";
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

function ToolCard({ tool }: { tool: ToolInfo }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
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
        {tool.category && (
          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground mt-1">
            {tool.category}
          </span>
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
  const [isOpen, setIsOpen] = React.useState(false);
  const [tools, setTools] = React.useState<ToolInfo[]>([]);
  const [isLoadingTools, setIsLoadingTools] = React.useState(false);

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open && tools.length === 0) {
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
  };

  const ActionButtons = (
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
  );

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger rightContent={ActionButtons}>
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
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
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

export default function ToolsetsPage() {
  const [toolsets, setToolsets] = React.useState<ToolsetInfo[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [uninstallDialogOpen, setUninstallDialogOpen] = React.useState(false);
  const [uninstallingToolset, setUninstallingToolset] =
    React.useState<ToolsetInfo | null>(null);
  const [isUninstalling, setIsUninstalling] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadToolsets = React.useCallback(async () => {
    try {
      const response = await listToolsets();
      setToolsets(response.toolsets);
      setError(null);
    } catch (err) {
      console.error("Failed to load toolsets:", err);
      setError("Failed to load toolsets");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
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
      const byteCharacters = atob(response.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const handle = importToolset({ file });
      await handle.promise;
      await loadToolsets();
    } catch (err) {
      console.error("Failed to import toolset:", err);
      setError(
        err instanceof Error ? err.message : "Failed to import toolset"
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Toolsets</h1>
        <p className="text-muted-foreground">
          Manage installed toolsets that provide Python tools and renderers.
        </p>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".zip"
        className="hidden"
      />

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
          <AlertCircle className="size-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="size-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Installed Toolsets</h2>
              <span className="text-sm text-muted-foreground">
                ({toolsets.length})
              </span>
            </div>
            <Button onClick={handleImportClick} disabled={isImporting}>
              {isImporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Import Toolset
            </Button>
          </div>

          {/* Toolset List */}
          {toolsets.length > 0 ? (
            <div className="space-y-3">
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
            <div className="border border-dashed border-border rounded-xl p-8 text-center">
              <Package className="size-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-4">
                No toolsets installed
              </p>
              <Button onClick={handleImportClick} disabled={isImporting}>
                {isImporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Import Your First Toolset
              </Button>
            </div>
          )}

          {/* Help text */}
          <div className="text-sm text-muted-foreground border-t pt-6 mt-6">
            <p className="mb-2">
              <strong>Toolsets</strong> are packages that provide Python tools
              with custom renderers. Each toolset can include:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Python tools that the AI can use</li>
              <li>Custom renderers for rich output display</li>
              <li>MCP servers for extended functionality</li>
            </ul>
          </div>
        </div>
      )}

      {/* Uninstall Dialog */}
      <UninstallDialog
        open={uninstallDialogOpen}
        onOpenChange={setUninstallDialogOpen}
        toolset={uninstallingToolset}
        onConfirm={handleUninstallConfirm}
        isUninstalling={isUninstalling}
      />
    </div>
  );
}
