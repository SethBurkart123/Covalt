"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Download,
  ChevronRight,
  Dot,
} from "lucide-react";
import { getWorkspaceFiles, getWorkspaceFile } from "@/python/api";
import { useWebSocket } from "@/contexts/websocket-context";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import { buildFileTree, type FileTreeNode } from "@/lib/workspace-file-tree";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PreviewType = "markdown" | "image" | "video" | "text" | "binary";

function getFileName(filePath: string | null): string {
  return filePath?.split("/").pop() || "File";
}

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

function getPreviewType(fileName: string): PreviewType {
  const ext = getFileExtension(fileName);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(
      ext,
    )
  ) {
    return "image";
  }
  if (["mp4", "webm", "mov", "m4v", "ogg"].includes(ext)) return "video";
  if (
    [
      "txt",
      "json",
      "yaml",
      "yml",
      "py",
      "js",
      "ts",
      "tsx",
      "jsx",
      "css",
      "html",
      "xml",
      "csv",
      "log",
    ].includes(ext)
  ) {
    return "text";
  }
  return "binary";
}

function getMimeType(fileName: string): string {
  const ext = getFileExtension(fileName);
  const map: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    html: "text/html",
    xml: "application/xml",
    csv: "text/csv",
    log: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    ogg: "video/ogg",
  };
  return map[ext] || "application/octet-stream";
}

function decodeBase64Utf8(base64: string): string {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    array[i] = bytes.charCodeAt(i);
  }
  return new TextDecoder().decode(array);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    array[i] = bytes.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType });
}

function getBase64ByteLength(base64: string): number {
  const padding = base64.match(/=+$/)?.[0].length ?? 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  onFileClick: (path: string) => void;
  changedInLastRun: Set<string>;
}

function FileNode({
  node,
  depth,
  onFileClick,
  changedInLastRun,
}: FileNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isChanged = changedInLastRun.has(node.path);

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-muted rounded-md transition-colors text-left"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <ChevronRight
            className={cn(
              "size-3 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
          {isOpen ? (
            <FolderOpen className="size-4 text-amber-500" />
          ) : (
            <Folder className="size-4 text-amber-500" />
          )}
          <span className="truncate">{node.name}</span>
          {isChanged && <Dot className="size-4 text-primary shrink-0" />}
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.map((child) => (
              <FileNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                changedInLastRun={changedInLastRun}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(node.path)}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-muted rounded-md transition-colors text-left",
        isChanged && "bg-primary/5",
      )}
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
    >
      <File className="size-4 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {isChanged && <Dot className="size-4 text-primary shrink-0" />}
    </button>
  );
}

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  filePath: string | null;
}

interface FilePreviewContentProps {
  previewType: PreviewType;
  textContent: string | null;
  objectUrl: string | null;
  fileName: string;
  fileSize: number;
  onDownload: () => void;
}

function FilePreviewContent({
  previewType,
  textContent,
  objectUrl,
  fileName,
  fileSize,
  onDownload,
}: FilePreviewContentProps) {
  if (previewType === "markdown") {
    return (
      <div className="h-[400px] border rounded-lg overflow-y-auto p-4">
        <MarkdownRenderer content={textContent || ""} />
      </div>
    );
  }

  if (previewType === "text") {
    return (
      <div className="h-[400px] border rounded-lg overflow-y-auto">
        <pre className="p-4 text-sm font-mono whitespace-pre-wrap break-all">
          {textContent}
        </pre>
      </div>
    );
  }

  if (previewType === "image" && objectUrl) {
    return (
      <div className="h-[400px] border rounded-lg overflow-auto bg-muted/20 flex items-center justify-center p-2">
        <img
          src={objectUrl}
          alt={fileName}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }

  if (previewType === "video" && objectUrl) {
    return (
      <div className="h-[400px] border rounded-lg overflow-hidden bg-black flex items-center justify-center">
        <video src={objectUrl} controls className="max-w-full max-h-full" />
      </div>
    );
  }

  return (
    <div className="p-4 text-center text-muted-foreground">
      <p>Binary file - {fileSize} bytes</p>
      <Button onClick={onDownload} className="mt-4">
        <Download className="size-4" />
        Download
      </Button>
    </div>
  );
}

function FilePreviewDialog({
  open,
  onOpenChange,
  chatId,
  filePath,
}: FilePreviewDialogProps) {
  const [base64Content, setBase64Content] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !filePath) {
      setBase64Content(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    getWorkspaceFile({ body: { chatId, path: filePath } })
      .then((response) => setBase64Content(response.content))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [open, chatId, filePath]);

  const fileName = getFileName(filePath);
  const mimeType = getMimeType(fileName);
  const previewType = getPreviewType(fileName);

  const textContent = useMemo(() => {
    if (!base64Content) return null;
    if (
      previewType === "binary" ||
      previewType === "image" ||
      previewType === "video"
    ) {
      return null;
    }
    return decodeBase64Utf8(base64Content);
  }, [base64Content, previewType]);

  const objectUrl = useMemo(() => {
    if (!base64Content) return null;
    if (previewType !== "image" && previewType !== "video") return null;
    const blob = base64ToBlob(base64Content, mimeType);
    return URL.createObjectURL(blob);
  }, [base64Content, mimeType, previewType]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const handleDownload = useCallback(() => {
    if (!base64Content || !filePath) return;

    const blob = base64ToBlob(base64Content, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [base64Content, filePath, fileName, mimeType]);

  const fileSize = base64Content ? getBase64ByteLength(base64Content) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-between pr-8">
            <span className="truncate">{fileName}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              disabled={!base64Content}
            >
              <Download className="size-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500">
              {error}
            </div>
          ) : base64Content !== null ? (
            <FilePreviewContent
              previewType={previewType}
              textContent={textContent}
              objectUrl={objectUrl}
              fileName={fileName}
              fileSize={fileSize}
              onDownload={handleDownload}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_CHANGED_PATHS: string[] = [];

interface WorkspaceBrowserProps {
  chatId: string;
  className?: string;
  lastRunChangedPaths?: string[];
  onFilesCountChange?: (count: number) => void;
}

export function WorkspaceBrowser({
  chatId,
  className,
  lastRunChangedPaths = EMPTY_CHANGED_PATHS,
  onFilesCountChange,
}: WorkspaceBrowserProps) {
  const [files, setFiles] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [wsChangedPaths, setWsChangedPaths] = useState<Set<string>>(new Set());

  const { onWorkspaceFilesChanged } = useWebSocket();
  const lastRunSourceRef = useRef<string | null>(null);

  const changedInLastRun = useMemo(() => {
    if (lastRunChangedPaths.length > 0) return new Set(lastRunChangedPaths);
    return wsChangedPaths;
  }, [lastRunChangedPaths, wsChangedPaths]);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = (await getWorkspaceFiles({ body: { chatId } })).files;
      setFiles(result);
      onFilesCountChange?.(result.length);
    } catch (err) {
      setError("Failed to load files");
      console.error("Failed to load workspace files:", err);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, onFilesCountChange]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    lastRunSourceRef.current = null;
  }, [lastRunChangedPaths]);

  useEffect(() => {
    return onWorkspaceFilesChanged(
      (eventChatId, changedPaths, deletedPaths, meta) => {
        if (eventChatId !== chatId) return;
        if (meta?.source !== "tool_run") return;

        if (meta?.sourceRef && lastRunSourceRef.current !== meta.sourceRef) {
          lastRunSourceRef.current = meta.sourceRef;
          setWsChangedPaths(new Set());
        }

        setWsChangedPaths((prev) => {
          const next = new Set(prev);
          changedPaths.forEach((path) => next.add(path));
          deletedPaths.forEach((path) => next.add(path));
          return next;
        });

        void loadFiles();
      },
    );
  }, [chatId, loadFiles, onWorkspaceFilesChanged]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder className="size-4 text-muted-foreground" />
          <span>Workspace</span>
          <span className="text-muted-foreground text-xs">
            ({files.length} files)
          </span>
          {changedInLastRun.size > 0 && (
            <span className="text-xs text-primary">
              {changedInLastRun.size} changed in last run
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={loadFiles}
          disabled={isLoading}
        >
          <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-3 text-sm text-red-500">{error}</div>
        ) : files.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground text-center">
            No files in workspace
          </div>
        ) : (
          <div className="py-1">
            {fileTree.map((node) => (
              <FileNode
                key={node.path}
                node={node}
                depth={0}
                onFileClick={setPreviewPath}
                changedInLastRun={changedInLastRun}
              />
            ))}
          </div>
        )}
      </div>

      <FilePreviewDialog
        open={previewPath !== null}
        onOpenChange={(open) => !open && setPreviewPath(null)}
        chatId={chatId}
        filePath={previewPath}
      />
    </div>
  );
}
