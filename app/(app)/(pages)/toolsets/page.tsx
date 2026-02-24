"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { usePageTitle } from "@/contexts/page-title-context";
import { useTools } from "@/contexts/tools-context";
import { Button } from "@/components/ui/button";
import { ServerFormDialog, DeleteDialog } from "@/components/mcp";
import ToolsetsSidebar, { type TabKey } from "./ToolsetsSidebar";
import InstalledPanel from "./InstalledPanel";
import BrowsePanel from "./BrowsePanel";

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

  return (
    <div className="flex w-full h-full">
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

          {activeTab === "browse" ? (
            <BrowsePanel />
          ) : (
            <InstalledPanel
              onEditServer={handleEditServer}
              onDeleteServer={handleDeleteServer}
            />
          )}
        </div>
      </main>

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
