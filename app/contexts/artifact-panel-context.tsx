"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useChat } from "@/contexts/chat-context";
import { useWebSocket } from "@/contexts/websocket-context";
import { getWorkspaceFile, updateWorkspaceFile } from "@/python/api";

export interface Artifact {
  id: string;
  title: string;
  content: ReactNode;
  filePath?: string;
}

export interface FileState {
  content: string;
  isLoading: boolean;
  isDeleted: boolean;
  version: number;
}

interface ArtifactPanelContextValue {
  isOpen: boolean;
  artifacts: Artifact[];
  activeId: string | null;
  open: (id: string, title: string, content: ReactNode, filePath?: string) => void;
  close: () => void;
  setActive: (id: string) => void;
  remove: (id: string) => void;
  openFile: (filePath: string) => void;
  closeFile: (filePath: string) => void;
  getFileState: (filePath: string) => FileState | undefined;
  saveFile: (filePath: string, content: string) => Promise<void>;
}

const ArtifactPanelContext = createContext<ArtifactPanelContextValue | null>(null);

export function ArtifactPanelProvider({ children }: { children: ReactNode }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<Map<string, FileState>>(new Map());

  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const { onWorkspaceFilesChanged } = useWebSocket();
  const { chatId } = useChat();

  const wasSidebarOpenRef = useRef<boolean | null>(null);
  const prevChatIdRef = useRef<string>("");
  const pendingFetchesRef = useRef<Set<string>>(new Set());

  const fetchFileContent = useCallback(
    async (filePath: string) => {
      if (!chatId || pendingFetchesRef.current.has(filePath)) return;

      pendingFetchesRef.current.add(filePath);

      try {
        const response = await getWorkspaceFile({
          body: { chatId, path: filePath },
        });
        const content = atob(response.content);

        setOpenFiles((prev) => {
          const next = new Map(prev);
          const existing = next.get(filePath);
          next.set(filePath, {
            content,
            isLoading: false,
            isDeleted: false,
            version: (existing?.version ?? 0) + 1,
          });
          return next;
        });
      } catch (error) {
        console.error(`Failed to fetch file ${filePath}:`, error);
        setOpenFiles((prev) => {
          const next = new Map(prev);
          const existing = next.get(filePath);
          next.set(filePath, {
            content: existing?.content ?? "",
            isLoading: false,
            isDeleted: true,
            version: existing?.version ?? 0,
          });
          return next;
        });
      } finally {
        pendingFetchesRef.current.delete(filePath);
      }
    },
    [chatId]
  );

  useEffect(() => {
    if (!chatId) return;

    return onWorkspaceFilesChanged((eventChatId, changedPaths, deletedPaths) => {
      if (eventChatId !== chatId) return;

      changedPaths.forEach((path) => {
        if (openFiles.has(path)) {
          fetchFileContent(path);
        }
      });

      if (deletedPaths.length > 0) {
        setOpenFiles((prev) => {
          const next = new Map(prev);
          let changed = false;
          deletedPaths.forEach((path) => {
            const existing = next.get(path);
            if (existing) {
              next.set(path, { ...existing, isDeleted: true });
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    });
  }, [chatId, openFiles, onWorkspaceFilesChanged, fetchFileContent]);

  const openFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        if (prev.has(filePath)) {
          fetchFileContent(filePath);
          return prev;
        }

        const next = new Map(prev);
        next.set(filePath, {
          content: "",
          isLoading: true,
          isDeleted: false,
          version: 0,
        });
        return next;
      });

      if (!pendingFetchesRef.current.has(filePath)) {
        fetchFileContent(filePath);
      }
    },
    [fetchFileContent]
  );

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const getFileState = useCallback(
    (filePath: string): FileState | undefined => {
      return openFiles.get(filePath);
    },
    [openFiles]
  );

  const saveFile = useCallback(
    async (filePath: string, content: string) => {
      if (!chatId) return;

      setOpenFiles((prev) => {
        const next = new Map(prev);
        const existing = next.get(filePath);
        if (existing) {
          next.set(filePath, { ...existing, content, isDeleted: false });
        }
        return next;
      });

      const encoded = btoa(unescape(encodeURIComponent(content)));
      await updateWorkspaceFile({
        body: { chatId, path: filePath, content: encoded },
      });
    },
    [chatId]
  );

  // Open artifact (with optional file tracking)
  const open = useCallback(
    (id: string, title: string, content: ReactNode, filePath?: string) => {
      const isFirstArtifact = artifacts.length === 0;
      setArtifacts((prev) => {
        const existing = prev.find((a) => a.id === id);
        if (existing) {
          // Update existing artifact
          return prev.map((a) =>
            a.id === id ? { ...a, title, content, filePath } : a
          );
        }
        return [...prev, { id, title, content, filePath }];
      });
      setActiveId(id);
      if (isFirstArtifact) {
        wasSidebarOpenRef.current = sidebarOpen;
        setSidebarOpen(false);
      }
    },
    [artifacts.length, sidebarOpen, setSidebarOpen]
  );

  // Close all artifacts and files
  const close = useCallback(() => {
    setArtifacts([]);
    setActiveId(null);
    setOpenFiles(new Map());
    if (wasSidebarOpenRef.current) {
      setSidebarOpen(true);
      wasSidebarOpenRef.current = null;
    }
  }, [setSidebarOpen]);

  // Set active artifact
  const setActive = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  // Remove artifact and close its associated file
  const remove = useCallback(
    (id: string) => {
      setArtifacts((prev) => {
        const artifactToRemove = prev.find((a) => a.id === id);
        const next = prev.filter((a) => a.id !== id);

        // Close the associated file if this artifact had one
        if (artifactToRemove?.filePath) {
          // Check if any other artifact is using this file
          const otherArtifactUsesFile = next.some(
            (a) => a.filePath === artifactToRemove.filePath
          );
          if (!otherArtifactUsesFile) {
            closeFile(artifactToRemove.filePath);
          }
        }

        if (next.length === 0) {
          setActiveId(null);
          setOpenFiles(new Map());
          if (wasSidebarOpenRef.current) {
            setSidebarOpen(true);
            wasSidebarOpenRef.current = null;
          }
        } else if (activeId === id) {
          setActiveId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeId, setSidebarOpen, closeFile]
  );

  // Clear artifacts when chat changes
  useEffect(() => {
    if (prevChatIdRef.current !== "" && prevChatIdRef.current !== chatId) {
      close();
    }
    prevChatIdRef.current = chatId;
  }, [chatId, close]);

  return (
    <ArtifactPanelContext.Provider
      value={{
        isOpen: artifacts.length > 0,
        artifacts,
        activeId,
        open,
        close,
        setActive,
        remove,
        openFile,
        closeFile,
        getFileState,
        saveFile,
      }}
    >
      {children}
    </ArtifactPanelContext.Provider>
  );
}

export function useArtifactPanel() {
  const context = useContext(ArtifactPanelContext);
  if (!context) {
    throw new Error("useArtifactPanel must be used within ArtifactPanelProvider");
  }
  return context;
}
