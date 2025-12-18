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

interface ToolsContextType {
  availableTools: ToolInfo[];
  activeToolIds: string[];
  toggleTool: (toolId: string) => void;
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

  // Load available tools on mount
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

  // Load active tools for current chat (or defaults for new chat)
  React.useEffect(() => {
    const loadActiveTools = async () => {
      setIsLoading(true);
      try {
        if (!chatId) {
          // No chat selected - load defaults for new chat
          const response = await getDefaultTools();
          setActiveToolIds(response.toolIds || []);
        } else {
          // Load this chat's specific tools from its agent_config
          try {
            const config = await getChatAgentConfig({ body: { id: chatId } });
            setActiveToolIds(config.toolIds || []);
          } catch (error) {
            console.error("Failed to load chat config:", error);
            // Fallback to defaults
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

  const toggleTool = React.useCallback(
    async (toolId: string) => {
      const newActiveToolIds = activeToolIds.includes(toolId)
        ? activeToolIds.filter((id) => id !== toolId)
        : [...activeToolIds, toolId];

      // Optimistically update UI
      setActiveToolIds(newActiveToolIds);

      try {
        if (chatId) {
          await toggleChatTools({
            body: { chatId, toolIds: newActiveToolIds },
          });
        }

        await setDefaultTools({ body: { toolIds: newActiveToolIds } });
      } catch (error) {
        console.error("Failed to toggle tool:", error);
        // Revert on error
        setActiveToolIds(activeToolIds);
      }
    },
    [chatId, activeToolIds]
  );

  const value = React.useMemo<ToolsContextType>(
    () => ({
      availableTools,
      activeToolIds,
      toggleTool,
      isLoading,
    }),
    [availableTools, activeToolIds, toggleTool, isLoading]
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
