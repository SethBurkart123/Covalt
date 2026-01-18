"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Download,
  ChevronRight,
} from "lucide-react";
import {
  getWorkspaceFiles,
  getWorkspaceFile,
} from "@/python/api";
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

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }).map((node) => ({
      ...node,
      children: node.children ? sortNodes(node.children) : undefined,
    }));
  };

  return sortNodes(root);
}

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  onFileClick: (path: string) => void;
}

function FileNode({ node, depth, onFileClick }: FileNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

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
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.map((child) => (
              <FileNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
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
      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-muted rounded-md transition-colors text-left"
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
    >
      <File className="size-4 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
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
      .catch((err: Error) => setError(err.message || "Failed to load file"))
      .finally(() => setIsLoading(false));
  }, [open, chatId, filePath]);

  const fileName = filePath?.split("/").pop() || "File";
  const isTextFile = /\.(txt|md|json|yaml|yml|py|js|ts|tsx|jsx|css|html|xml|csv|log)$/i.test(fileName);

  const handleDownload = () => {
    if (!content || !filePath) return;
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
}

export function WorkspaceBrowser({ chatId, className }: WorkspaceBrowserProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getWorkspaceFiles({ body: { chatId } });
      setFiles(response.files);
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

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder className="size-4 text-muted-foreground" />
          <span>Workspace</span>
          <span className="text-muted-foreground text-xs">
            ({files.length} files)
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={loadFiles}
          disabled={isLoading}
        >
          <RefreshCw
            className={cn("size-3.5", isLoading && "animate-spin")}
          />
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
