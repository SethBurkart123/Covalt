"use client";

import * as React from "react";
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
  /** Tools grouped by category (toolsets/MCP), plus ungrouped built-in tools */
  groupedTools: GroupedTools;
  toggleTool: (toolId: string) => void;
  toggleToolset: (category: string) => void;
  isToolsetActive: (category: string) => boolean;
  isToolsetPartiallyActive: (category: string) => boolean;
  /** Loading state for available tools list (use this for tools page) */
  isLoadingTools: boolean;
  /** Loading state for active tool IDs (chat-specific) */
  isLoadingActiveTools: boolean;
  /** MCP servers with real-time status from WebSocket */
  mcpServers: McpServerStatus[];
  /** Manually refresh the tools list */
  refreshTools: () => void;
}

const ToolsContext = React.createContext<ToolsContextType | undefined>(
  undefined
);

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const { chatId } = useChat();
  const { mcpServers } = useMcpStatus();

  const [availableTools, setAvailableTools] = React.useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = React.useState<string[]>([]);
  const [isLoadingTools, setIsLoadingTools] = React.useState(true);
  const [isLoadingActiveTools, setIsLoadingActiveTools] = React.useState(true);

  // Track connected server IDs to detect changes
  const connectedServerIds = React.useMemo(
    () =>
      mcpServers
        .filter((s) => s.status === "connected")
        .map((s) => s.id)
        .sort()
        .join(","),
    [mcpServers]
  );

  const loadTools = React.useCallback(async () => {
    setIsLoadingTools(true);
    try {
      const response = await getAvailableTools();
      setAvailableTools(response?.tools || []);
    } catch (error) {
      console.error("Failed to load available tools:", error);
      setAvailableTools([]);
    } finally {
      setIsLoadingTools(false);
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    loadTools();
  }, [loadTools]);

  // Reload tools when connected MCP servers change
  React.useEffect(() => {
    // Skip the initial empty state
    if (connectedServerIds !== "") {
      loadTools();
    }
  }, [connectedServerIds, loadTools]);

  React.useEffect(() => {
    const loadActiveTools = async () => {
      setIsLoadingActiveTools(true);
      try {
        if (!chatId) {
          const response = await getDefaultTools();
          setActiveToolIds(response.toolIds || []);
        } else {
          try {
            const config = await getChatAgentConfig({ body: { id: chatId } });
            setActiveToolIds(config.toolIds || []);
          } catch (error) {
            console.error("Failed to load chat config:", error);
            const response = await getDefaultTools();
            setActiveToolIds(response.toolIds || []);
          }
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

  const groupedTools = React.useMemo(() => {
    const ungrouped: ToolInfo[] = [];
    const byCategory: ToolsByCategory = {};
    
    availableTools.forEach((tool) => {
      const category = tool.category;
      if (!category || category === "auto") {
        // Built-in tools have no category - they go in ungrouped
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

  const persistTools = React.useCallback(
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

  const toggleTool = React.useCallback(
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

  const isToolsetActive = React.useCallback(
    (category: string) => {
      const tools = groupedTools.byCategory[category];
      if (!tools || tools.length === 0) return false;
      return tools.every((tool) => activeToolIds.includes(tool.id));
    },
    [groupedTools.byCategory, activeToolIds]
  );

  const isToolsetPartiallyActive = React.useCallback(
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

  const toggleToolset = React.useCallback(
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

  const value = React.useMemo<ToolsContextType>(
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
      refreshTools: loadTools,
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
      mcpServers,
      loadTools,
    ]
  );

  return (
    <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
  );
}

export function useTools() {
  const context = React.useContext(ToolsContext);
  if (context === undefined) {
    throw new Error("useTools must be used within a ToolsProvider");
  }
  return context;
}
