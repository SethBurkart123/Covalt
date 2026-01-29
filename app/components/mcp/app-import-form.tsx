"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Check } from "lucide-react";
import {
  scanImportSources,
  type ScanImportSourcesResponse,
  type ScannedServer,
} from "@/python/api";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IMPORT_SOURCES, IMPORT_SOURCE_MAP } from "./importers";

type CheckboxButtonEl = HTMLButtonElement & { indeterminate?: boolean };

export interface AppImportFormRef {
  getSelectedServers: () => ScannedServer[];
  getSelectedCount: () => number;
  isReady: () => boolean;
}

interface AppImportFormProps {
  onSelectionChange?: (count: number) => void;
}

export const AppImportForm = forwardRef<AppImportFormRef, AppImportFormProps>(
  function AppImportForm({ onSelectionChange }, ref) {
    const [scanResults, setScanResults] =
      useState<ScanImportSourcesResponse | null>(null);
    const [isScanning, setIsScanning] = useState(true);
    const [scanError, setScanError] = useState<string | null>(null);
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(
      new Set()
    );
    const selectAllRef = useRef<CheckboxButtonEl>(null);

  useEffect(() => {
    const scan = async () => {
      setIsScanning(true);
      setScanError(null);
      try {
        const results = await scanImportSources();
        setScanResults(results);

        const firstSourceWithServers = IMPORT_SOURCES.find(
          (source) => (results.results[source.key]?.servers?.length ?? 0) > 0
        );
        if (!firstSourceWithServers) return;

        setSelectedSource(firstSourceWithServers.key);
        setSelectedServerIds(
          new Set(results.results[firstSourceWithServers.key].servers.map((s) => s.id))
        );
      } catch (e) {
        setScanError(e instanceof Error ? e.message : "Failed to scan for apps");
      } finally {
        setIsScanning(false);
      }
    };

    scan();
  }, []);

  const availableSources = useMemo(() => {
    if (!scanResults) return [];
    return IMPORT_SOURCES.filter(
      (source) => (scanResults.results[source.key]?.servers?.length ?? 0) > 0
    );
  }, [scanResults]);

  const currentServers = useMemo(() => {
    if (!scanResults || !selectedSource) return [];
    return scanResults.results[selectedSource]?.servers ?? [];
  }, [scanResults, selectedSource]);

  const handleSourceChange = useCallback((sourceKey: string) => {
    setSelectedSource(sourceKey);
    if (!scanResults) return;
    const serverIds = scanResults.results[sourceKey]?.servers?.map((s) => s.id) ?? [];
    setSelectedServerIds(new Set(serverIds));
  }, [scanResults]);

  const handleServerToggle = useCallback((serverId: string, checked: boolean) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      checked ? next.add(serverId) : next.delete(serverId);
      return next;
    });
  }, []);

  const handleSelectAllToggle = useCallback((checked: boolean) => {
    setSelectedServerIds(checked ? new Set(currentServers.map((s) => s.id)) : new Set());
  }, [currentServers]);

  const allSelected =
    currentServers.length > 0 && selectedServerIds.size === currentServers.length;
  const someSelected = selectedServerIds.size > 0 && selectedServerIds.size < currentServers.length;

  const selectedServers = useMemo(
    () => currentServers.filter((s) => selectedServerIds.has(s.id)),
    [currentServers, selectedServerIds]
  );

  const formatCommandPreview = (server: ScannedServer) => {
    if (typeof server.config.url === "string" && server.config.url.length > 0) {
      return server.config.url;
    }
    const cmd = typeof server.config.command === "string" ? server.config.command : "";
    const args = Array.isArray(server.config.args)
      ? server.config.args.filter((a): a is string => typeof a === "string")
      : [];
    return [cmd, ...args].join(" ");
  };

  useImperativeHandle(
    ref,
    () => ({
      getSelectedServers: () => selectedServers,
      getSelectedCount: () => selectedServerIds.size,
      isReady: () => !isScanning && !scanError,
    }),
    [selectedServers, selectedServerIds.size, isScanning, scanError]
  );

  useEffect(() => {
    onSelectionChange?.(selectedServerIds.size);
  }, [selectedServerIds.size, onSelectionChange]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (isScanning) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Scanning for apps...</span>
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
        {scanError}
      </div>
    );
  }

  if (availableSources.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No MCP servers found in other applications.</p>
        <p className="text-sm mt-2">
          Supported apps: Claude Desktop, Claude Code, OpenCode, Cursor
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-hidden">
      <div className="space-y-2">
        <Label>Select Application</Label>
        <Select value={selectedSource ?? ""} onValueChange={handleSourceChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an application">
              {selectedSource && IMPORT_SOURCE_MAP[selectedSource] && (() => {
                const Icon = IMPORT_SOURCE_MAP[selectedSource].icon;
                return (
                  <span className="flex items-center gap-2">
                    <Icon />
                    {IMPORT_SOURCE_MAP[selectedSource].name}
                  </span>
                );
              })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableSources.map((source) => {
              const serverCount = scanResults?.results[source.key]?.servers?.length ?? 0;
              return (
                <SelectItem key={source.key} value={source.key}>
                  <span className="flex items-center gap-2">
                    <source.icon />
                    <span>{source.name}</span>
                    <span className="text-muted-foreground text-xs">
                      ({serverCount} server{serverCount !== 1 ? "s" : ""})
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {selectedSource && currentServers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 pb-2 border-b">
            <Checkbox
              id="select-all"
              checked={allSelected}
              ref={selectAllRef}
              onCheckedChange={handleSelectAllToggle}
            />
            <Label htmlFor="select-all" className="text-sm cursor-pointer">
              Select All ({currentServers.length} server{currentServers.length !== 1 ? "s" : ""})
            </Label>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto overflow-x-hidden">
            {currentServers.map((server) => (
              <div
                key={server.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors overflow-hidden",
                  selectedServerIds.has(server.id)
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-border/80"
                )}
              >
                <Checkbox
                  id={`server-${server.id}`}
                  checked={selectedServerIds.has(server.id)}
                  onCheckedChange={(checked) => handleServerToggle(server.id, !!checked)}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <Label
                    htmlFor={`server-${server.id}`}
                    className="text-sm font-medium cursor-pointer block truncate"
                  >
                    {server.id}
                  </Label>
                  <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                    {formatCommandPreview(server)}
                  </p>
                </div>
                {selectedServerIds.has(server.id) && (
                  <Check className="size-4 text-primary shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
