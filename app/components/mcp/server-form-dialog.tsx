"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Wrench,
  Loader2,
  FileJson,
  Code,
  Server,
  Download,
} from "lucide-react";
import {
  addMcpServer,
  updateMcpServer,
  getMcpServerConfig,
  getMcpServers,
  listToolsets,
  type MCPServerConfig,
  type ScannedServer,
} from "@/python/api";
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
import { KeyValueInput } from "@/components/ui/key-value-input";
import type { ServerFormData, ServerType } from "./types";
import { emptyFormData } from "./types";
import {
  configToFormData,
  ensureUniqueServerId,
  parseCommandString,
  slugifyServerId,
} from "./utils";
import { AppImportForm, type AppImportFormRef } from "./app-import-form";
import {
  ImportConflictDialog,
  generateUniqueName,
  type ConflictResolution,
} from "./import-conflict-dialog";

interface ServerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingServerKey?: string | null;
  editingServerId?: string | null;
  editingServerName?: string | null;
  onSuccess: () => void;
}

export function ServerFormDialog({
  open,
  onOpenChange,
  editingServerKey,
  editingServerId,
  editingServerName,
  onSuccess,
}: ServerFormDialogProps) {
  const [mode, setMode] = useState<"form" | "json" | "import">("form");
  const [formData, setFormData] = useState<ServerFormData>(emptyFormData);
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());

  const [conflictServer, setConflictServer] = useState<ScannedServer | null>(null);
  const existingIdsRef = useRef<Set<string>>(new Set());
  const existingKeyByIdRef = useRef<Map<string, string>>(new Map());
  const [selectedImportCount, setSelectedImportCount] = useState(0);
  const importFormRef = useRef<AppImportFormRef>(null);
  const importQueueRef = useRef<ScannedServer[]>([]);
  const importOpsRef = useRef<
    Array<{ id: string; config: MCPServerConfig; isUpdate: boolean }>
  >([]);

  const derivedId = useMemo(() => {
    const base = slugifyServerId(formData.name || formData.id);
    return ensureUniqueServerId(base, existingIds, editingServerId ?? formData.id);
  }, [formData.name, formData.id, existingIds, editingServerId]);



  useEffect(() => {
    if (open && !!editingServerKey) {
      setIsLoadingConfig(true);
      setError(null);
      setJsonError(null);
      setMode("form");

      getMcpServerConfig({ body: { id: editingServerKey } })
        .then((config) => {
          const serverId = editingServerId ?? editingServerKey;
          setFormData(
            configToFormData(
              serverId,
              editingServerName ?? serverId,
              config
            )
          );
        })
        .catch((e) => {
          console.error("Failed to load server config:", e);
          setFormData({
            ...emptyFormData,
            id: editingServerId ?? editingServerKey,
            name: editingServerName ?? editingServerId ?? editingServerKey,
          });
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
  }, [open, editingServerKey, editingServerId, editingServerName]);

  useEffect(() => {
    if (!open) return;
    Promise.all([getMcpServers(), listToolsets({ body: undefined })])
      .then(([serverResponse, toolsetResponse]) => {
        const ids = new Set<string>();
        serverResponse.servers.forEach((server) => {
          ids.add(server.serverId ?? server.id);
        });
        toolsetResponse.toolsets.forEach((toolset) => {
          ids.add(toolset.id);
        });
        setExistingIds(ids);
      })
      .catch((e) => {
        console.error("Failed to load existing toolset ids:", e);
      });
  }, [open]);

  const runImportOps = useCallback(async () => {
    const ops = importOpsRef.current;
    importOpsRef.current = [];
    importQueueRef.current = [];

    const results = await Promise.allSettled(
      ops.map(({ id, config, isUpdate }) =>
        isUpdate
          ? updateMcpServer({ body: { id, config } })
          : addMcpServer({ body: { id, config } })
      )
    );
    results.forEach((r, idx) => {
      if (r.status === "rejected") console.error(`Failed to import server ${ops[idx].id}:`, r.reason);
    });

    onSuccess();
    onOpenChange(false);
    setIsSubmitting(false);
  }, [onSuccess, onOpenChange]);

  const showNextConflictOrFinish = useCallback(() => {
    setConflictServer(null);

    while (importQueueRef.current.length > 0) {
      const server = importQueueRef.current[0];
      if (existingIdsRef.current.has(server.id)) {
        setConflictServer(server);
        return;
      }

      importQueueRef.current.shift();
      importOpsRef.current.push({
        id: server.id,
        config: server.config as MCPServerConfig,
        isUpdate: false,
      });
      existingIdsRef.current.add(server.id);
    }

    void runImportOps();
  }, [runImportOps]);

  const startImport = useCallback(async () => {
    const servers = importFormRef.current?.getSelectedServers();
    if (!servers || servers.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const [{ servers: existingServers }, toolsetResponse] = await Promise.all([
        getMcpServers(),
        listToolsets({ body: undefined }),
      ]);
      const idSet = new Set<string>();
      const keyById = new Map<string, string>();
      existingServers.forEach((server) => {
        const serverId = server.serverId ?? server.id;
        idSet.add(serverId);
        if (!keyById.has(serverId)) {
          keyById.set(serverId, server.id);
        }
      });
      toolsetResponse.toolsets.forEach((toolset) => {
        idSet.add(toolset.id);
      });
      existingIdsRef.current = idSet;
      existingKeyByIdRef.current = keyById;
      importQueueRef.current = [...servers];
      importOpsRef.current = [];
      showNextConflictOrFinish();
    } catch (e) {
      console.error("Failed to start import:", e);
      setError("Failed to check existing servers");
      setIsSubmitting(false);
    }
  }, [showNextConflictOrFinish]);

  const handleConflictCancel = useCallback(() => {
    setConflictServer(null);
    setIsSubmitting(false);
  }, []);

  const handleConflictResolve = useCallback(
    (resolution: ConflictResolution) => {
      if (!conflictServer) return;

      importQueueRef.current.shift();

      if (resolution === "rename") {
        const id = generateUniqueName(conflictServer.id, existingIdsRef.current);
        importOpsRef.current.push({
          id,
          config: conflictServer.config as MCPServerConfig,
          isUpdate: false,
        });
        existingIdsRef.current.add(id);
      } else if (resolution === "overwrite") {
        const existingKey = existingKeyByIdRef.current.get(conflictServer.id);
        importOpsRef.current.push({
          id: existingKey ?? conflictServer.id,
          config: conflictServer.config as MCPServerConfig,
          isUpdate: true,
        });
      }

      showNextConflictOrFinish();
    },
    [conflictServer, showNextConflictOrFinish]
  );

  const parseHeadersString = (headersStr: string): Record<string, string> | undefined => {
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
      const trimmedUrl = formData.url.trim();
      config.url = trimmedUrl || undefined;
      config.transport = formData.type;
      const headers = parseHeadersString(formData.headers);
      if (headers) config.headers = headers;
    }

    const envObj: Record<string, string> = {};
    for (const { key, value } of formData.env) {
      if (key.trim()) envObj[key.trim()] = value;
    }
    if (Object.keys(envObj).length > 0) config.env = envObj;

    return config;
  };

  const validateFormData = useCallback((data: ServerFormData): string | null => {
    if (data.type === "stdio") {
      const { command } = parseCommandString(data.command);
      if (!command.trim()) {
        return "Command is required for stdio servers.";
      }
      return null;
    }

    const url = data.url.trim();
    if (!url) {
      return "URL is required for SSE or Streamable HTTP servers.";
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "URL must start with http:// or https://.";
      }
    } catch {
      return "URL must be a valid absolute URL (e.g., http://localhost:8080/sse).";
    }

    return null;
  }, []);

  const formValidationError = useMemo(
    () => (mode === "form" ? validateFormData(formData) : null),
    [formData, mode, validateFormData]
  );

  const handleFormSubmit = async () => {
    const validationError = validateFormData(formData);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const config = buildConfigFromForm();

      const displayName = formData.name.trim() || "MCP Server";

      if (!!editingServerKey) {
        await updateMcpServer({
          body: { id: editingServerKey, name: displayName, config },
        });
      } else {
        await addMcpServer({
          body: { name: displayName, config },
        });
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
      const servers = parsed.mcpServers || (typeof parsed === "object" ? parsed : null);

      if (!servers || typeof servers !== "object") throw new Error(
        "Invalid JSON format. Expected { mcpServers: {...} } or { serverId: config }"
      );

      if (Object.keys(servers).length === 0) throw new Error("No servers found in JSON");

      const serverIds = Object.keys(servers);
      const results = await Promise.allSettled(
        Object.entries(servers).map(async ([id, rawConfig]) => {
          try {
            await addMcpServer({ body: { id, config: rawConfig as MCPServerConfig } });
          } catch {
            await updateMcpServer({ body: { id, config: rawConfig as MCPServerConfig } });
          }
        })
      );
      results.forEach((r, idx) => {
        if (r.status === "rejected") console.error(`Failed to import server ${serverIds[idx]}:`, r.reason);
      });

      onSuccess();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof SyntaxError) {
        setJsonError("Invalid JSON syntax");
      } else {
        setError(e instanceof Error ? e.message : "Failed to import servers");
      }
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {!!editingServerKey ? "Edit MCP Server" : "Add MCP Server"}
          </DialogTitle>
          <DialogDescription>
            {!!editingServerKey
              ? "Update the configuration for this MCP server."
              : "Add a new MCP server to extend your AI with external tools."}
          </DialogDescription>
        </DialogHeader>

        {!editingServerKey && (
          <div className="flex gap-1 p-1 bg-muted rounded-lg overflow-hidden">
            <button
              onClick={() => setMode("form")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium rounded-md transition-colors min-w-0",
                mode === "form"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Wrench className="size-4 shrink-0" />
              <span className="truncate">Form</span>
            </button>
            <button
              onClick={() => setMode("json")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium rounded-md transition-colors min-w-0",
                mode === "json"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileJson className="size-4 shrink-0" />
              <span className="truncate">JSON</span>
            </button>
            <button
              onClick={() => setMode("import")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium rounded-md transition-colors min-w-0",
                mode === "import"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Download className="size-4 shrink-0" />
              <span className="truncate">From App</span>
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
          <ServerForm
            formData={formData}
            setFormData={setFormData}
            derivedId={derivedId}
          />
        ) : mode === "json" ? (
          <JsonImportForm
            jsonInput={jsonInput}
            setJsonInput={setJsonInput}
            jsonError={jsonError}
            setJsonError={setJsonError}
          />
        ) : (
          <AppImportForm
            ref={importFormRef}
            onSelectionChange={setSelectedImportCount}
          />
        )}

        <ImportConflictDialog
          open={!!conflictServer}
          serverId={conflictServer?.id ?? ""}
          suggestedName={conflictServer ? generateUniqueName(conflictServer.id, existingIdsRef.current) : ""}
          onResolve={handleConflictResolve}
          onCancel={handleConflictCancel}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode !== "import" ? (
            <Button
              onClick={mode === "form" ? handleFormSubmit : handleJsonSubmit}
              disabled={isSubmitting || isLoadingConfig || (mode === "form" && !!formValidationError)}
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {!!editingServerKey
                ? "Update Server"
                : mode === "json"
                  ? "Import"
                  : "Add Server"}
            </Button>
          ) : (
            <Button
              onClick={startImport}
              disabled={isSubmitting || isLoadingConfig || selectedImportCount === 0}
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {selectedImportCount > 0 ? `Import (${selectedImportCount})` : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ServerFormProps {
  formData: ServerFormData;
  setFormData: (data: ServerFormData) => void;
  derivedId: string;
}

function ServerForm({
  formData,
  setFormData,
  derivedId,
}: ServerFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Server Name</label>
        <Input
          placeholder="Exa Search"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{derivedId}</span>
        </p>
      </div>

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
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
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

      {(formData.type === "sse" || formData.type === "streamable-http") && (
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
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
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

      <KeyValueInput
        label="Environment Variables"
        description="API keys and secrets for the MCP server"
        values={formData.env}
        onChange={(env) => setFormData({ ...formData, env })}
        keyPlaceholder="API_KEY"
        valuePlaceholder="your-secret-key"
      />

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
  );
}

interface JsonImportFormProps {
  jsonInput: string;
  setJsonInput: (value: string) => void;
  jsonError: string | null;
  setJsonError: (error: string | null) => void;
}

function JsonImportForm({
  jsonInput,
  setJsonInput,
  jsonError,
  setJsonError,
}: JsonImportFormProps) {
  return (
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
          Paste your MCP server configuration JSON. Supports Claude Desktop
          format.
        </p>
      </div>
    </div>
  );
}
