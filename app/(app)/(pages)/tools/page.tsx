"use client";

import { useState, useEffect, useMemo } from "react";
import type React from "react";
import {
  Server,
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  Plug,
  Plus,
  Pencil,
  Trash2,
  Code,
  FileJson,
  Minus,
} from "lucide-react";
import { useTools, type McpServerStatus } from "@/contexts/tools-context";
import {
  reconnectMcpServer,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  getMcpServerConfig,
  type MCPServerConfig,
} from "@/python/api";
import type { ToolInfo } from "@/lib/types/chat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

type ServerType = "stdio" | "sse" | "streamable-http";

interface EnvVar {
  key: string;
  value: string;
}

interface ServerFormData {
  id: string;
  type: ServerType;
  command: string;
  cwd: string;
  url: string;
  env: EnvVar[];
  headers: string;
  requiresConfirmation: boolean;
}

const emptyFormData: ServerFormData = {
  id: "",
  type: "stdio",
  command: "",
  cwd: "",
  url: "",
  env: [],
  headers: "",
  requiresConfirmation: true,
};

function StatusBadge({ status }: { status: McpServerStatus["status"] }) {
  const {
    icon: Icon,
    label,
    className,
  } = {
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
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border",
        className
      )}
    >
      <Icon
        className={cn("size-3", status === "connecting" && "animate-spin")}
      />
      {label}
    </span>
  );
}

interface KeyValueInputProps {
  label: string;
  description?: string;
  values: EnvVar[];
  onChange: (values: EnvVar[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

function KeyValueInput({
  label,
  description,
  values,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
}: KeyValueInputProps) {
  const addRow = () => {
    onChange([...values, { key: "", value: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: "key" | "value", val: string) => {
    const updated = [...values];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          {label}{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addRow}
          className="h-7 text-xs"
        >
          <Plus className="size-3" />
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
            <span>Key</span>
            <span>Value</span>
            <span className="w-8" />
          </div>
          {values.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                placeholder={keyPlaceholder}
                value={item.key}
                onChange={(e) => updateRow(index, "key", e.target.value)}
                className="font-mono text-sm"
              />
              <Input
                placeholder={valuePlaceholder}
                value={item.value}
                onChange={(e) => updateRow(index, "value", e.target.value)}
                className="font-mono text-sm"
                type="password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(index)}
                className="size-9 text-muted-foreground hover:text-destructive"
              >
                <Minus className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function configToFormData(
  id: string,
  config: Record<string, unknown>
): ServerFormData {
  let serverType: ServerType = "stdio";
  if (
    config.type &&
    typeof config.type === "string" &&
    (config.type === "sse" || config.type === "streamable-http" || config.type === "stdio")
  ) {
    serverType = config.type;
  }

  let fullCommand = (config.command as string) || "";
  if (config.args && Array.isArray(config.args)) {
    const argsStr = (config.args as string[])
      .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
      .join(" ");
    if (argsStr) {
      fullCommand = fullCommand ? `${fullCommand} ${argsStr}` : argsStr;
    }
  }

  const envVars: EnvVar[] = [];
  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(config.env as Record<string, string>)) {
      envVars.push({ key, value: value === "***" ? "" : value });
    }
  }

  return {
    id,
    type: serverType,
    command: fullCommand,
    cwd: (config.cwd as string) || "",
    url: (config.url as string) || "",
    env: envVars,
    headers: config.headers
      ? JSON.stringify(config.headers, null, 2)
      : "",
    requiresConfirmation: config.requiresConfirmation !== false,
  };
}

function parseCommandString(cmdStr: string): { command: string; args: string[] } {
  if (!cmdStr.trim()) return { command: "", args: [] };

  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of cmdStr.trim()) {
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = "";
    } else if (!inQuote && char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  if (tokens.length === 0) return { command: "", args: [] };
  return { command: tokens[0], args: tokens.slice(1) };
}

interface ServerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingServerId?: string | null;
  onSuccess: () => void;
}

function ServerFormDialog({
  open,
  onOpenChange,
  editingServerId,
  onSuccess,
}: ServerFormDialogProps) {
  const [mode, setMode] = useState<"form" | "json">("form");
  const [formData, setFormData] = useState<ServerFormData>(emptyFormData);
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editingServerId;

  useEffect(() => {
    if (open && editingServerId) {
      setIsLoadingConfig(true);
      setError(null);
      setJsonError(null);
      setMode("form");

      getMcpServerConfig({ body: { id: editingServerId } })
        .then((config) => {
          setFormData(configToFormData(editingServerId, config));
        })
        .catch((e) => {
          console.error("Failed to load server config:", e);
          setFormData({ ...emptyFormData, id: editingServerId });
        })
        .finally(() => {
          setIsLoadingConfig(false);
        });
    } else if (open) {
      setFormData(emptyFormData);
      setJsonInput("");
      setError(null);
      setJsonError(null);
      setMode("form");
    }
  }, [open, editingServerId]);

  const parseHeadersString = (
    headersStr: string
  ): Record<string, string> | undefined => {
    if (!headersStr.trim()) return undefined;
    try {
      return JSON.parse(headersStr);
    } catch {
      return undefined;
    }
  };

  const buildConfigFromForm = (): MCPServerConfig => {
    const config: MCPServerConfig = {
      requiresConfirmation: formData.requiresConfirmation,
    };

    if (formData.type === "stdio") {
      const { command, args } = parseCommandString(formData.command);
      config.command = command || undefined;
      if (args.length > 0) config.args = args;
      if (formData.cwd.trim()) config.cwd = formData.cwd;
    } else {
      config.url = formData.url || undefined;
      config.transport = formData.type;
      const headers = parseHeadersString(formData.headers);
      if (headers) config.headers = headers;
    }

    const envObj: Record<string, string> = {};
    for (const { key, value } of formData.env) {
      if (key.trim()) {
        envObj[key.trim()] = value;
      }
    }
    if (Object.keys(envObj).length > 0) {
      config.env = envObj;
    }

    return config;
  };

  const handleFormSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const config = buildConfigFromForm();

      if (isEditing) {
        await updateMcpServer({ body: { id: formData.id, config } });
      } else {
        if (!formData.id.trim()) {
          throw new Error("Server ID is required");
        }
        await addMcpServer({ body: { id: formData.id, config } });
      }

      onSuccess();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJsonSubmit = async () => {
    setError(null);
    setJsonError(null);
    setIsSubmitting(true);

    try {
      const parsed = JSON.parse(jsonInput);
      const servers =
        parsed.mcpServers || (typeof parsed === "object" ? parsed : null);

      if (!servers || typeof servers !== "object") {
        throw new Error(
          "Invalid JSON format. Expected { mcpServers: {...} } or { serverId: config }"
        );
      }

      const serverEntries = Object.entries(servers);
      if (serverEntries.length === 0) {
        throw new Error("No servers found in JSON");
      }

      for (const [id, rawConfig] of serverEntries) {
        const config = rawConfig as MCPServerConfig;
        try {
          await addMcpServer({ body: { id, config } });
        } catch {
          try {
            await updateMcpServer({ body: { id, config } });
          } catch (e) {
            console.error(`Failed to import server ${id}:`, e);
          }
        }
      }

      onSuccess();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof SyntaxError) {
        setJsonError("Invalid JSON syntax");
      } else {
        setError(e instanceof Error ? e.message : "Failed to import servers");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit MCP Server" : "Add MCP Server"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the configuration for this MCP server."
              : "Add a new MCP server to extend your AI with external tools."}
          </DialogDescription>
        </DialogHeader>

        {!isEditing && (
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setMode("form")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "form"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Wrench className="size-4" />
              Form
            </button>
            <button
              onClick={() => setMode("json")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "json"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileJson className="size-4" />
              Import JSON
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {error}
          </div>
        )}

        {isLoadingConfig ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : mode === "form" ? (
          <div className="space-y-4">
            {/* Server ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Server ID</label>
              <Input
                placeholder="my-server"
                value={formData.id}
                onChange={(e) =>
                  setFormData({ ...formData, id: e.target.value })
                }
                disabled={isEditing}
              />
              <p className="text-xs text-muted-foreground">
                A unique identifier for this server (e.g., &quot;perplexity&quot;,
                &quot;calculator&quot;)
              </p>
            </div>

            {/* Server Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Server Type</label>
              <Select
                value={formData.type}
                onValueChange={(v) =>
                  setFormData({ ...formData, type: v as ServerType })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">
                    <span className="flex items-center gap-2">
                      <Code className="size-4" />
                      stdio (Command-line)
                    </span>
                  </SelectItem>
                  <SelectItem value="sse">
                    <span className="flex items-center gap-2">
                      <Server className="size-4" />
                      SSE (Server-Sent Events)
                    </span>
                  </SelectItem>
                  <SelectItem value="streamable-http">
                    <span className="flex items-center gap-2">
                      <Server className="size-4" />
                      Streamable HTTP
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stdio-specific fields */}
            {formData.type === "stdio" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Command</label>
                  <Input
                    placeholder="npx -y perplexity-mcp"
                    value={formData.command}
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Full command with arguments (e.g., npx -y @anthropic/mcp-server)
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Working Directory{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    placeholder="/path/to/directory"
                    value={formData.cwd}
                    onChange={(e) =>
                      setFormData({ ...formData, cwd: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {/* HTTP-specific fields */}
            {(formData.type === "sse" ||
              formData.type === "streamable-http") && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">URL</label>
                  <Input
                    placeholder="http://localhost:8080/sse"
                    value={formData.url}
                    onChange={(e) =>
                      setFormData({ ...formData, url: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Headers{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <textarea
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] font-mono dark:bg-input/30"
                    placeholder='{"Authorization": "Bearer token"}'
                    value={formData.headers}
                    onChange={(e) =>
                      setFormData({ ...formData, headers: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">JSON object</p>
                </div>
              </>
            )}

            {/* Environment Variables - Key/Value Input */}
            <KeyValueInput
              label="Environment Variables"
              description="API keys and secrets for the MCP server"
              values={formData.env}
              onChange={(env) => setFormData({ ...formData, env })}
              keyPlaceholder="API_KEY"
              valuePlaceholder="your-secret-key"
            />

            {/* Requires Confirmation */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="requiresConfirmation"
                checked={formData.requiresConfirmation}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    requiresConfirmation: !!checked,
                  })
                }
              />
              <Label htmlFor="requiresConfirmation" className="text-sm cursor-pointer">
                Require confirmation before tool execution
              </Label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">JSON Configuration</label>
              <textarea
                className={cn(
                  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[300px] font-mono dark:bg-input/30",
                  jsonError && "border-red-500 focus-visible:ring-red-500/50"
                )}
                placeholder={`{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "perplexity-mcp"],
      "env": {
        "PERPLEXITY_API_KEY": "your-key"
      }
    }
  }
}`}
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  setJsonError(null);
                }}
              />
              {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
              <p className="text-xs text-muted-foreground">
                Paste your MCP server configuration JSON. Supports Claude
                Desktop format.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={mode === "form" ? handleFormSubmit : handleJsonSubmit}
            disabled={isSubmitting || isLoadingConfig}
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing
              ? "Update Server"
              : mode === "json"
                ? "Import"
                : "Add Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  onSuccess: () => void;
}

function DeleteDialog({
  open,
  onOpenChange,
  serverId,
  onSuccess,
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeMcpServer({ body: { id: serverId } });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete server:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete MCP Server</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">{serverId}</span>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="size-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface McpServerCardProps {
  server: McpServerStatus;
  tools: ToolInfo[];
  onEdit: () => void;
  onDelete: () => void;
}

function McpServerCard({
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
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
              <StatusBadge status={server.status} />
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

function BuiltinToolCard({ tool }: { tool: ToolInfo }) {
  return (
    <div className="flex items-start gap-3 p-4 border border-border rounded-lg bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-center size-9 rounded-lg bg-muted">
        <Wrench className="size-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm mb-1">{tool.name || tool.id}</h3>
        {tool.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {tool.description}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { availableTools, mcpServers, isLoadingTools, refreshTools } = useTools();

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

  const builtinTools = useMemo(
    () => availableTools.filter((t) => !t.id.startsWith("mcp:")),
    [availableTools]
  );

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

          {builtinTools.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Wrench className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Built-in Tools</h2>
                <span className="text-sm text-muted-foreground">
                  ({builtinTools.length})
                </span>
              </div>

              <div className="grid gap-3">
                {builtinTools.map((tool) => (
                  <BuiltinToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          )}

          {mcpServers.length === 0 && builtinTools.length === 0 && (
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
