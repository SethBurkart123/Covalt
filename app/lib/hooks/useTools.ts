import { useState, useEffect, useCallback } from 'react';
import { getAvailableTools, toggleChatTools, setDefaultTools, getDefaultTools } from '@/python/apiClient';
import type { ToolInfo } from '@/lib/types/chat';

export function useTools(chatId: string) {
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load available tools on mount
  useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await getAvailableTools(undefined);
        setAvailableTools(response.tools);
      } catch (error) {
        console.error('Failed to load available tools:', error);
        setAvailableTools([]);
      }
    };

    loadTools();
  }, []);

  // Load active tools for current chat (or defaults for new chat)
  useEffect(() => {
    const loadActiveTools = async () => {
      setIsLoading(true);
      try {
        if (!chatId) {
          // No chat selected - load defaults
          const response = await getDefaultTools(undefined);
          setActiveToolIds(response.tool_ids || []);
        } else {
          // Load chat's active tools
          // For now, load from defaults - we'll get this from chat's agent_config later
          const response = await getDefaultTools(undefined);
          setActiveToolIds(response.tool_ids || []);
        }
      } catch (error) {
        console.error('Failed to load active tools:', error);
        setActiveToolIds([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadActiveTools();
  }, [chatId]);

  const toggleTool = useCallback(async (toolId: string) => {
    const newActiveToolIds = activeToolIds.includes(toolId)
      ? activeToolIds.filter(id => id !== toolId)
      : [...activeToolIds, toolId];

    // Optimistically update UI
    setActiveToolIds(newActiveToolIds);

    try {
      // Save to current chat if one exists
      if (chatId) {
        await toggleChatTools({ chatId, toolIds: newActiveToolIds }, undefined);
      }

      // Always save as defaults for future chats
      await setDefaultTools({ tool_ids: newActiveToolIds }, undefined);
    } catch (error) {
      console.error('Failed to toggle tool:', error);
      // Revert on error
      setActiveToolIds(activeToolIds);
    }
  }, [chatId, activeToolIds]);

  return {
    availableTools,
    activeToolIds,
    toggleTool,
    isLoading,
  };
}

