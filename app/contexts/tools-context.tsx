"use client";

import * as React from "react";
import { useChat } from "@/contexts/chat-context";
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

interface ToolsContextType {
  availableTools: ToolInfo[];
  activeToolIds: string[];
  toolsByCategory: ToolsByCategory;
  toggleTool: (toolId: string) => void;
  toggleToolset: (category: string) => void;
  isToolsetActive: (category: string) => boolean;
  isToolsetPartiallyActive: (category: string) => boolean;
  isLoading: boolean;
}

const ToolsContext = React.createContext<ToolsContextType | undefined>(
  undefined
);

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const { chatId } = useChat();

  const [availableTools, setAvailableTools] = React.useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await getAvailableTools();
        setAvailableTools(response?.tools || []);
      } catch (error) {
        console.error("Failed to load available tools:", error);
        setAvailableTools([]);
      }
    };

    loadTools();
  }, []);

  React.useEffect(() => {
    const loadActiveTools = async () => {
      setIsLoading(true);
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
        setIsLoading(false);
      }
    };

    loadActiveTools();
  }, [chatId]);

  const toolsByCategory = React.useMemo(() => {
    const grouped: ToolsByCategory = {};
    availableTools.forEach((tool) => {
      const category = tool.category || "Other";
      if (category === "auto") return;
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(tool);
    });
    return grouped;
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
      const tools = toolsByCategory[category];
      if (!tools || tools.length === 0) return false;
      return tools.every((tool) => activeToolIds.includes(tool.id));
    },
    [toolsByCategory, activeToolIds]
  );

  const isToolsetPartiallyActive = React.useCallback(
    (category: string) => {
      const tools = toolsByCategory[category];
      if (!tools || tools.length === 0) return false;
      const activeCount = tools.filter((tool) =>
        activeToolIds.includes(tool.id)
      ).length;
      return activeCount > 0 && activeCount < tools.length;
    },
    [toolsByCategory, activeToolIds]
  );

  const toggleToolset = React.useCallback(
    async (category: string) => {
      const tools = toolsByCategory[category];
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
    [toolsByCategory, activeToolIds, isToolsetActive, persistTools]
  );

  const value = React.useMemo<ToolsContextType>(
    () => ({
      availableTools,
      activeToolIds,
      toolsByCategory,
      toggleTool,
      toggleToolset,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoading,
    }),
    [
      availableTools,
      activeToolIds,
      toolsByCategory,
      toggleTool,
      toggleToolset,
      isToolsetActive,
      isToolsetPartiallyActive,
      isLoading,
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
