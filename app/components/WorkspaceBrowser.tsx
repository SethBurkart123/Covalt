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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const path of paths) {
    const parts = path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: isLast ? undefined : [],
        };
        current.push(node);
      }

      if (!isLast && node.children) {
        current = node.children;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }));

  return sortNodes(root);
}

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  onFileClick: (path: string) => void;
  changedInLastRun: Set<string>;
}

function FileNode({ node, depth, onFileClick, changedInLastRun }: FileNodeProps) {
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
              isOpen && "rotate-90"
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
        isChanged && "bg-primary/5"
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

function FilePreviewDialog({
  open,
  onOpenChange,
  chatId,
  filePath,
}: FilePreviewDialogProps) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !filePath) {
      setContent(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    getWorkspaceFile({ body: { chatId, path: filePath } })
      .then((response) => setContent(atob(response.content)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [open, chatId, filePath]);

  const handleDownload = () => {
    if (!content || !filePath) return;
    const fileName = filePath.split("/").pop() || "File";
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fileName = filePath?.split("/").pop() || "File";
  const isTextFile =
    /\.(txt|md|json|yaml|yml|py|js|ts|tsx|jsx|css|html|xml|csv|log)$/i.test(
      fileName
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between pr-8">
            <span className="truncate">{fileName}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              disabled={!content}
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
          ) : content !== null ? (
            isTextFile ? (
              <div className="h-[400px] border rounded-lg overflow-y-auto">
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap break-all">
                  {content}
                </pre>
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                <p>Binary file - {content.length} bytes</p>
                <Button onClick={handleDownload} className="mt-4">
                  <Download className="size-4" />
                  Download
                </Button>
              </div>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface WorkspaceBrowserProps {
  chatId: string;
  className?: string;
  lastRunChangedPaths?: string[];
}

export function WorkspaceBrowser({
  chatId,
  className,
  lastRunChangedPaths = [],
}: WorkspaceBrowserProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [changedInLastRun, setChangedInLastRun] = useState<Set<string>>(new Set());

  const { onWorkspaceFilesChanged } = useWebSocket();
  const lastRunSourceRef = useRef<string | null>(null);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setFiles((await getWorkspaceFiles({ body: { chatId } })).files);
    } catch (err) {
      setError("Failed to load files");
      console.error("Failed to load workspace files:", err);
    } finally {
      setIsLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (lastRunChangedPaths.length > 0) {
      setChangedInLastRun(new Set(lastRunChangedPaths));
    } else {
      setChangedInLastRun(new Set());
    }
    lastRunSourceRef.current = null;
  }, [lastRunChangedPaths]);

  useEffect(() => {
    return onWorkspaceFilesChanged((eventChatId, changedPaths, deletedPaths, meta) => {
      if (eventChatId !== chatId) return;
      if (meta?.source !== "tool_run") return;

      if (meta?.sourceRef && lastRunSourceRef.current !== meta.sourceRef) {
        lastRunSourceRef.current = meta.sourceRef;
        setChangedInLastRun(new Set());
      }

      setChangedInLastRun((prev) => {
        const next = new Set(prev);
        changedPaths.forEach((path) => next.add(path));
        deletedPaths.forEach((path) => next.add(path));
        return next;
      });

      void loadFiles();
    });
  }, [chatId, loadFiles, onWorkspaceFilesChanged]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder className="size-4 text-muted-foreground" />
          <span>Workspace</span>
          <span className="text-muted-foreground text-xs">({files.length} files)</span>
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

