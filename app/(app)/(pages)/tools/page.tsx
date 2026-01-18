"use client";

import { useState, useMemo } from "react";
import { Server, Wrench, Loader2, Plug, Plus } from "lucide-react";
import { useTools } from "@/contexts/tools-context";
import type { ToolInfo } from "@/lib/types/chat";
import { Button } from "@/components/ui/button";
import {
  McpServerCard,
  ServerFormDialog,
  DeleteDialog,
} from "@/components/mcp";

export default function ToolsPage() {
  const { availableTools, mcpServers, isLoadingTools, refreshTools } =
    useTools();

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingServerId, setDeletingServerId] = useState("");

  const mcpTools = useMemo(() => {
    const byServer: Record<string, ToolInfo[]> = {};
    availableTools.forEach((tool) => {
      if (tool.id.startsWith("mcp:")) {
        const serverId = tool.id.split(":")[1];
        if (!byServer[serverId]) byServer[serverId] = [];
        byServer[serverId].push(tool);
      }
    });
    return byServer;
  }, [availableTools]);

  const handleAddServer = () => {
    setEditingServerId(null);
    setFormDialogOpen(true);
  };

  const handleEditServer = (serverId: string) => {
    setEditingServerId(serverId);
    setFormDialogOpen(true);
  };

  const handleDeleteServer = (serverId: string) => {
    setDeletingServerId(serverId);
    setDeleteDialogOpen(true);
  };

  const handleSuccess = () => {
    refreshTools?.();
  };

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Tools</h1>
        <p className="text-muted-foreground">
          Manage MCP servers and available tools for your AI agents.
        </p>
      </div>

      {isLoadingTools ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Server className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">MCP Servers</h2>
                <span className="text-sm text-muted-foreground">
                  ({mcpServers.length})
                </span>
              </div>
              <Button onClick={handleAddServer}>
                <Plus className="size-4" />
                Add Server
              </Button>
            </div>

            {mcpServers.length > 0 ? (
              <div className="space-y-3">
                {mcpServers.map((server) => (
                  <McpServerCard
                    key={server.id}
                    server={server}
                    tools={mcpTools[server.id] || []}
                    onEdit={() => handleEditServer(server.id)}
                    onDelete={() => handleDeleteServer(server.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-xl p-8 text-center">
                <Plug className="size-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-4">
                  No MCP servers configured
                </p>
                <Button onClick={handleAddServer}>
                  <Plus className="size-4" />
                  Add Your First Server
                </Button>
              </div>
            )}
          </section>

          {mcpServers.length === 0 && (
            <div className="text-center py-12">
              <Wrench className="size-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">No tools available</p>
            </div>
          )}
        </div>
      )}

      <ServerFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        editingServerId={editingServerId}
        onSuccess={handleSuccess}
      />
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        serverId={deletingServerId}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
