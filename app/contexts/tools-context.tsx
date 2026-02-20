"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useChat } from "@/contexts/chat-context";
import {
  useMcpStatus,
  type McpServerStatus,
} from "@/contexts/websocket-context";
import {
  getAvailableTools,
  setDefaultTools,
  getDefaultTools,
  getChatAgentConfig,
  toggleChatTools,
} from "@/python/api";
import type { ToolInfo } from "@/lib/types/chat";
import type { ToolInfo as ApiToolInfo } from "@/python/api";
import { getPrefetchedChat } from "@/lib/services/chat-prefetch";

export interface ToolsByCategory {
  [category: string]: ToolInfo[];
}

export interface GroupedTools {
  ungrouped: ToolInfo[];
  byCategory: ToolsByCategory;
}

export type { McpServerStatus };

type ToolInfoLike = ApiToolInfo | ToolInfo | {
  id?: string;
  toolId?: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
};

const normalizeToolInfo = (tool: ToolInfoLike): ToolInfo | null => {
  const raw = tool as {
    id?: string;
    toolId?: string;
    name?: string | null;
    description?: string | null;
    category?: string | null;
  };
  const id = raw.id ?? raw.toolId;
  if (!id) return null;
  return {
    id,
    name: raw.name ?? null,
    description: raw.description ?? null,
    category: raw.category ?? null,
  };
};

interface ToolsCatalogContextType {
  availableTools: ToolInfo[];
  groupedTools: GroupedTools;
  isLoadingTools: boolean;
  mcpServers: McpServerStatus[];
  refreshTools: () => void;
  removeMcpServer: (serverId: string) => void;
}

interface ToolsActiveContextType {
  activeToolIds: string[];
  toggleTool: (toolId: string) => void;
  toggleToolset: (category: string) => void;
  setChatToolIds: (
    toolIds: string[],
    options?: { persistDefaults?: boolean }
  ) => Promise<void>;
  isToolsetActive: (category: string) => boolean;
  isToolsetPartiallyActive: (category: string) => boolean;
  isLoadingActiveTools: boolean;
}

const ToolsCatalogContext = createContext<ToolsCatalogContextType | undefined>(undefined);
const ToolsActiveContext = createContext<ToolsActiveContextType | undefined>(undefined);

export function ToolsProvider({ children }: { children: ReactNode }) {
  const { chatId } = useChat();
  const { mcpServers, removeMcpServer } = useMcpStatus();

  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = useState<string[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(true);
  const [isLoadingActiveTools, setIsLoadingActiveTools] = useState(true);
  const hasLoadedToolsOnce = useRef(false);
  const pendingChatToolIdsRef = useRef<string[] | null>(null);

  const connectedServerIds = useMemo(
    () =>
      mcpServers
        .filter((s) => s.status === "connected")
        .map((s) => s.id)
        .sort()
        .join(","),
    [mcpServers]
  );

  const loadTools = useCallback(async () => {
    if (!hasLoadedToolsOnce.current) {
      setIsLoadingTools(true);
    }
    try {
      const response = await getAvailableTools();
      const normalizedTools = (response?.tools || [])
        .map((tool) => normalizeToolInfo(tool))
        .filter((tool): tool is ToolInfo => tool !== null);
      setAvailableTools(normalizedTools);
      hasLoadedToolsOnce.current = true;
    } catch (error) {
      console.error("Failed to load available tools:", error);
      setAvailableTools([]);
    } finally {
      setIsLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  useEffect(() => {
    if (connectedServerIds !== "") {
      loadTools();
    }
  }, [connectedServerIds, loadTools]);

  useEffect(() => {
    const loadActiveTools = async () => {
      setIsLoadingActiveTools(true);
      try {
        if (chatId) {
          const prefetched = getPrefetchedChat(chatId);
          const isFresh = prefetched && Date.now() - prefetched.fetchedAt < 2_000;
          if (prefetched?.agentConfig?.toolIds) {
            setActiveToolIds(prefetched.agentConfig.toolIds);
          }

          if (pendingChatToolIdsRef.current) {
            const pending = pendingChatToolIdsRef.current;
            pendingChatToolIdsRef.current = null;
            setActiveToolIds(pending);
            await toggleChatTools({ body: { chatId, toolIds: pending } });
          } else {
            if (!isFresh || !prefetched?.agentConfig) {
              const config = await getChatAgentConfig({ body: { id: chatId } });
              setActiveToolIds(config.toolIds || []);
            }
          }
        } else {
          const response = await getDefaultTools();
          setActiveToolIds(response.toolIds || []);
        }
      } catch (error) {
        console.error("Failed to load active tools:", error);
        setActiveToolIds([]);
      } finally {
        setIsLoadingActiveTools(false);
      }
    };

    loadActiveTools();
  }, [chatId]);

  const groupedTools = useMemo(() => {
    const ungrouped: ToolInfo[] = [];
    const byCategory: ToolsByCategory = {};

    availableTools.forEach((tool) => {
      const category = tool.category;
      if (!category || category === "auto") {
        ungrouped.push(tool);
        return;
      }
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(tool);
    });

    return { ungrouped, byCategory };
  }, [availableTools]);

  const persistTools = useCallback(
    async (newToolIds: string[], options?: { persistDefaults?: boolean }) => {
      const persistDefaults = options?.persistDefaults ?? true;
      try {
        if (chatId) {
          await toggleChatTools({
            body: { chatId, toolIds: newToolIds },
          });
        } else if (!persistDefaults) {
          pendingChatToolIdsRef.current = newToolIds;
        }

        if (persistDefaults) {
          await setDefaultTools({ body: { toolIds: newToolIds } });
        }
      } catch (error) {
        console.error("Failed to persist tools:", error);
        throw error;
      }
    },
    [chatId]
  );

  const setChatToolIds = useCallback(
    async (newToolIds: string[], options?: { persistDefaults?: boolean }) => {
      const prevToolIds = activeToolIds;
      setActiveToolIds(newToolIds);

      try {
        await persistTools(newToolIds, options);
      } catch {
        setActiveToolIds(prevToolIds);
      }
    },
    [activeToolIds, persistTools]
  );

  const toggleTool = useCallback(
    async (toolId: string) => {
      const newActiveToolIds = activeToolIds.includes(toolId)
        ? activeToolIds.filter((id) => id !== toolId)
        : [...activeToolIds, toolId];

      setActiveToolIds(newActiveToolIds);

      try {
        await persistTools(newActiveToolIds);
      } catch {
        setActiveToolIds(activeToolIds);
      }
    },
    [activeToolIds, persistTools]
  );

  const isToolsetActive = useCallback(
    (category: string) => {
      const tools = groupedTools.byCategory[category];
      if (!tools || tools.length === 0) return false;
      return tools.every((tool) => activeToolIds.includes(tool.id));
    },
    [groupedTools.byCategory, activeToolIds]
  );

  const isToolsetPartiallyActive = useCallback(
    (category: string) => {
      const tools = groupedTools.byCategory[category];
      if (!tools || tools.length === 0) return false;
      const activeCount = tools.filter((tool) =>
        activeToolIds.includes(tool.id)
      ).length;
      return activeCount > 0 && activeCount < tools.length;
    },
    [groupedTools.byCategory, activeToolIds]
  );

  const toggleToolset = useCallback(
    async (category: string) => {
      const tools = groupedTools.byCategory[category];
      if (!tools || tools.length === 0) return;

      const newActiveToolIds = isToolsetActive(category)
        ? activeToolIds.filter((id) => !tools.some((t) => t.id === id))
        : [...new Set([...activeToolIds, ...tools.map((t) => t.id)])];

      setActiveToolIds(newActiveToolIds);

      try {
        await persistTools(newActiveToolIds);
      } catch {
        setActiveToolIds(activeToolIds);
      }
    },
    [groupedTools.byCategory, activeToolIds, isToolsetActive, persistTools]
  );

  const refreshTools = useCallback(() => {
    void loadTools();
  }, [loadTools]);

  const catalogValue = useMemo<ToolsCatalogContextType>(
    () => ({
      availableTools,
      groupedTools,
      isLoadingTools,
      mcpServers,
      refreshTools,
      removeMcpServer,
    }),
    [
      availableTools,
      groupedTools,
      isLoadingTools,
      mcpServers,
      refreshTools,
      removeMcpServer,
    ]
  );

  const activeValue = useMemo<ToolsActiveContextType>(
    () => ({
      activeToolIds,
      toggleTool,
      toggleToolset,
      setChatToolIds,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoadingActiveTools,
    }),
    [
      activeToolIds,
      toggleTool,
      toggleToolset,
      setChatToolIds,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoadingActiveTools,
    ]
  );

  return (
    <ToolsCatalogContext.Provider value={catalogValue}>
      <ToolsActiveContext.Provider value={activeValue}>
        {children}
      </ToolsActiveContext.Provider>
    </ToolsCatalogContext.Provider>
  );
}

export function useTools() {
  const catalog = useContext(ToolsCatalogContext);
  const active = useContext(ToolsActiveContext);
  if (catalog === undefined || active === undefined) {
    throw new Error("useTools must be used within a ToolsProvider");
  }
  return { ...catalog, ...active };
}

export function useToolsCatalog() {
  const context = useContext(ToolsCatalogContext);
  if (context === undefined) {
    throw new Error("useToolsCatalog must be used within a ToolsProvider");
  }
  return context;
}

export function useToolsActive() {
  const context = useContext(ToolsActiveContext);
  if (context === undefined) {
    throw new Error("useToolsActive must be used within a ToolsProvider");
  }
  return context;
}
