"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { getWorkspaceFiles } from "@/python/api";
import { useWebSocket } from "@/contexts/websocket-context";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { EditableCodeViewer } from "@/components/EditableCodeViewer";
import { cn } from "@/lib/utils";
import { buildFileTree, type FileTreeNode } from "@/lib/workspace-file-tree";
import { getFileIcon } from "./file-icon";
import { extensionToLanguage } from "@/components/tool-renderers/code/utils";

function inferLanguageFromPath(filePath: string): string {
  const ext = filePath.includes(".")
    ? filePath.split(".").pop()
    : undefined;
  return extensionToLanguage(ext) || "text";
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  onToggleDirectory: (path: string) => void;
  onFileSelect: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onToggleDirectory,
  onFileSelect,
}: TreeNodeProps) {
  if (node.isDirectory) {
    const isOpen = expandedDirs.has(node.path);

    return (
      <div>
        <button
          onClick={() => onToggleDirectory(node.path)}
          className="flex items-center gap-1.5 w-full py-[3px] text-[13px] hover:bg-muted/60 transition-colors text-left select-none"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight
            className={cn(
              "size-3 text-muted-foreground/70 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          {isOpen ? (
            <FolderOpen className="size-4 text-amber-500/80 shrink-0" />
          ) : (
            <Folder className="size-4 text-amber-500/80 shrink-0" />
          )}
          <span className="truncate text-foreground/90">{node.name}</span>
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                expandedDirs={expandedDirs}
                onToggleDirectory={onToggleDirectory}
                onFileSelect={onFileSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  const isSelected = node.path === selectedPath;

  return (
    <button
      onClick={() => onFileSelect(node.path)}
      className={cn(
        "flex items-center gap-1.5 w-full py-[3px] text-[13px] transition-colors text-left select-none",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "text-foreground/80 hover:bg-muted/60",
      )}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      <Icon className="size-4 text-muted-foreground shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

interface FileEditorContentProps {
  chatId: string;
  rootPath: string;
  editable: boolean;
}

const MIN_TREE_WIDTH = 140;
const MAX_TREE_WIDTH = 400;
const DEFAULT_TREE_WIDTH = 200;

export function FileEditorContent({
  chatId,
  rootPath,
  editable,
}: FileEditorContentProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const { openFile, getFileState } = useArtifactPanel();
  const { onWorkspaceFilesChanged } = useWebSocket();

  const normalizedRoot = useMemo(() => {
    const trimmed = rootPath.replace(/^\/+|\/+$/g, "");
    return trimmed ? trimmed + "/" : "";
  }, [rootPath]);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getWorkspaceFiles({ body: { chatId } });
      const filtered = normalizedRoot
        ? response.files.filter((f: string) => f.startsWith(normalizedRoot))
        : response.files;

      const stripped = normalizedRoot
        ? filtered.map((f: string) => f.slice(normalizedRoot.length))
        : filtered;

      setFiles(stripped);
    } catch (err) {
      console.error("Failed to load workspace files:", err);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, normalizedRoot]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    return onWorkspaceFilesChanged((eventChatId) => {
      if (eventChatId !== chatId) return;
      void loadFiles();
    });
  }, [chatId, loadFiles, onWorkspaceFilesChanged]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const handleToggleDirectory = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileSelect = useCallback(
    (relativePath: string) => {
      const fullPath = normalizedRoot + relativePath;
      setSelectedFile(relativePath);
      openFile(fullPath);
    },
    [normalizedRoot, openFile],
  );

  const selectedFullPath = selectedFile
    ? normalizedRoot + selectedFile
    : null;
  const fileState = selectedFullPath ? getFileState(selectedFullPath) : undefined;
  const language = selectedFullPath
    ? inferLanguageFromPath(selectedFullPath)
    : "text";

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
    },
    [],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, newWidth)));
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <div
        className="flex flex-col border-r border-border shrink-0 overflow-hidden"
        style={{ width: treeWidth }}
      >
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No files
            </div>
          ) : (
            fileTree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedFile}
                expandedDirs={expandedDirs}
                onToggleDirectory={handleToggleDirectory}
                onFileSelect={handleFileSelect}
              />
            ))
          )}
        </div>
      </div>

      <div
        className={cn(
          "w-[3px] cursor-col-resize shrink-0 transition-colors hover:bg-primary/30",
          isResizing && "bg-primary/40",
        )}
        onMouseDown={handleResizeStart}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedFullPath && fileState ? (
          <EditableCodeViewer
            language={language}
            filePath={selectedFullPath}
            readOnly={!editable}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
