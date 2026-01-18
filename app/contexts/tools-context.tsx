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

export interface ToolsByCategory {
  [category: string]: ToolInfo[];
}

export interface GroupedTools {
  ungrouped: ToolInfo[];
  byCategory: ToolsByCategory;
}

export type { McpServerStatus };

interface ToolsContextType {
  availableTools: ToolInfo[];
  activeToolIds: string[];
  groupedTools: GroupedTools;
  toggleTool: (toolId: string) => void;
  toggleToolset: (category: string) => void;
  isToolsetActive: (category: string) => boolean;
  isToolsetPartiallyActive: (category: string) => boolean;
  isLoadingTools: boolean;
  isLoadingActiveTools: boolean;
  mcpServers: McpServerStatus[];
  refreshTools: () => void;
  removeMcpServer: (serverId: string) => void;
}

const ToolsContext = createContext<ToolsContextType | undefined>(undefined);

export function ToolsProvider({ children }: { children: ReactNode }) {
  const { chatId } = useChat();
  const { mcpServers, removeMcpServer } = useMcpStatus();

  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = useState<string[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(true);
  const [isLoadingActiveTools, setIsLoadingActiveTools] = useState(true);
  const hasLoadedToolsOnce = useRef(false);

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
      setAvailableTools(response?.tools || []);
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
        let toolIds: string[] | undefined;
        if (chatId) {
          try {
            const config = await getChatAgentConfig({ body: { id: chatId } });
            toolIds = config.toolIds || [];
          } catch (error) {
            console.error("Failed to load chat config:", error);
          }
        }
        if (!toolIds) {
          const response = await getDefaultTools();
          toolIds = response.toolIds || [];
        }
        setActiveToolIds(toolIds);
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
    async (newToolIds: string[]) => {
      try {
        if (chatId) {
          await toggleChatTools({
            body: { chatId, toolIds: newToolIds },
          });
        }
        await setDefaultTools({ body: { toolIds: newToolIds } });
      } catch (error) {
        console.error("Failed to persist tools:", error);
        throw error;
      }
    },
    [chatId]
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

      const toolIds = tools.map((t) => t.id);
      const newActiveToolIds = isToolsetActive(category)
        ? activeToolIds.filter((id) => !toolIds.includes(id))
        : [...new Set([...activeToolIds, ...toolIds])];

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

  const value = useMemo<ToolsContextType>(
    () => ({
      availableTools,
      activeToolIds,
      groupedTools,
      toggleTool,
      toggleToolset,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoadingTools,
      isLoadingActiveTools,
      mcpServers,
      refreshTools,
      removeMcpServer,
    }),
    [
      availableTools,
      activeToolIds,
      groupedTools,
      toggleTool,
      toggleToolset,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoadingTools,
      isLoadingActiveTools,
      removeMcpServer,
      mcpServers,
      refreshTools,
    ]
  );

  return (
    <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
  );
}

export function useTools() {
  const context = useContext(ToolsContext);
  if (context === undefined) {
    throw new Error("useTools must be used within a ToolsProvider");
  }
  return context;
}
