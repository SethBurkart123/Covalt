
import { useState, useEffect, useCallback, useRef } from "react";
import type { DragEvent } from "react";
import { Plus, Upload, Loader2 } from "lucide-react";
import { zipSync } from "fflate";
import { usePageTitle } from "@/contexts/page-title-context";
import { useTools } from "@/contexts/tools-context";
import { importToolset } from "@/python/api";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/mcp/delete-dialog";
import { ServerFormDialog } from "@/components/mcp/server-form-dialog";
import ToolsetsSidebar, { type TabKey } from "./ToolsetsSidebar";
import InstalledPanel from "./InstalledPanel";
import BrowsePanel from "./BrowsePanel";

async function readDirectoryEntry(
  dirEntry: FileSystemDirectoryEntry,
  basePath = "",
): Promise<Record<string, Uint8Array>> {
  const result: Record<string, Uint8Array> = {};

  const entries = await new Promise<FileSystemEntry[]>((resolve) => {
    const reader = dirEntry.createReader();
    const allEntries: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(allEntries);
        } else {
          allEntries.push(...batch);
          readBatch();
        }
      });
    };
    readBatch();
  });

  for (const entry of entries) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve),
      );
      const buffer = await file.arrayBuffer();
      result[path] = new Uint8Array(buffer);
    } else if (entry.isDirectory) {
      const subFiles = await readDirectoryEntry(
        entry as FileSystemDirectoryEntry,
        path,
      );
      Object.assign(result, subFiles);
    }
  }

  return result;
}

export default function ToolsetsPage() {
  const { setTitle } = usePageTitle();
  const { refreshTools, removeMcpServer } = useTools();
  const [activeTab, setActiveTab] = useState<TabKey>("installed");
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingServerKey, setEditingServerKey] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingServerKey, setDeletingServerKey] = useState("");
  const [deletingServerLabel, setDeletingServerLabel] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isDropImporting, setIsDropImporting] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [importSignal, setImportSignal] = useState(0);
  const dragCounter = useRef(0);

  useEffect(() => {
    setTitle("Toolsets");
  }, [setTitle]);

  const handleAddServer = () => {
    setEditingServerKey(null);
    setEditingServerId(null);
    setEditingServerName(null);
    setFormDialogOpen(true);
  };

  const handleEditServer = (serverKey: string, serverId: string, serverName: string) => {
    setEditingServerKey(serverKey);
    setEditingServerId(serverId);
    setEditingServerName(serverName);
    setFormDialogOpen(true);
  };

  const handleDeleteServer = (serverKey: string, serverLabel: string) => {
    setDeletingServerKey(serverKey);
    setDeletingServerLabel(serverLabel);
    setDeleteDialogOpen(true);
  };

  const handleSuccess = () => {
    refreshTools();
  };

  const handleDeleteSuccess = () => {
    removeMcpServer(deletingServerKey);
    refreshTools();
  };

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      setDropError(null);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const firstItem = items[0];
      if (firstItem.kind !== "file") return;

      const file = firstItem.getAsFile();
      if (!file) return;

      if (
        file.name.endsWith(".zip") ||
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed"
      ) {
        setIsDropImporting(true);
        try {
          await importToolset({ file });
          setImportSignal((n) => n + 1);
          refreshTools();
        } catch (err) {
          console.error("Failed to import dropped zip:", err);
          setDropError(
            err instanceof Error ? err.message : "Failed to import toolset",
          );
        } finally {
          setIsDropImporting(false);
        }
        return;
      }

      const entry =
        "webkitGetAsEntry" in firstItem
          ? (
              firstItem as DataTransferItem & {
                webkitGetAsEntry: () => FileSystemEntry | null;
              }
            ).webkitGetAsEntry()
          : null;

      if (entry?.isDirectory) {
        setIsDropImporting(true);
        try {
          const zipData = await readDirectoryEntry(
            entry as FileSystemDirectoryEntry,
          );

          if (!zipData["toolset.yaml"] && !zipData["toolset.yml"]) {
            setDropError("No toolset.yaml found in dropped folder");
            return;
          }

          const zipped = zipSync(zipData);
          const zipFile = new File([zipped], "toolset.zip", {
            type: "application/zip",
          });
          await importToolset({ file: zipFile });
          setImportSignal((n) => n + 1);
          refreshTools();
        } catch (err) {
          console.error("Failed to import dropped folder:", err);
          setDropError(
            err instanceof Error ? err.message : "Failed to import folder",
          );
        } finally {
          setIsDropImporting(false);
        }
        return;
      }

      setDropError("Drop a .zip file or a toolset folder to import");
    },
    [refreshTools],
  );

  return (
    <div
      className="flex w-full h-full relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ToolsetsSidebar activeTab={activeTab} onChangeTab={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-4xl px-4 mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold">
                {activeTab === "installed" ? "Installed" : "Browse Toolsets"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTab === "installed"
                  ? "Manage your MCP servers and installed toolsets"
                  : "Discover and install new toolsets"}
              </p>
            </div>
            {activeTab === "installed" && (
              <Button onClick={handleAddServer}>
                <Plus className="size-4" />
                Add Server
              </Button>
            )}
          </div>

          {dropError && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {dropError}
            </div>
          )}

          {activeTab === "browse" ? (
            <BrowsePanel />
          ) : (
            <InstalledPanel
              onEditServer={handleEditServer}
              onDeleteServer={handleDeleteServer}
              importSignal={importSignal}
            />
          )}
        </div>
      </main>

      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10">
              <Upload className="size-8 text-primary" />
            </div>
            <p className="text-lg font-medium">Drop to import toolset</p>
            <p className="text-sm text-muted-foreground">
              .zip files or toolset folders
            </p>
          </div>
        </div>
      )}

      {isDropImporting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-lg font-medium">Importing toolset...</p>
          </div>
        </div>
      )}

      <ServerFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        editingServerKey={editingServerKey}
        editingServerId={editingServerId}
        editingServerName={editingServerName}
        onSuccess={handleSuccess}
      />
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        serverKey={deletingServerKey}
        serverLabel={deletingServerLabel ?? undefined}
        onSuccess={handleDeleteSuccess}
      />
    </div>
  );
}
