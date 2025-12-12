import { useState, useEffect, useCallback } from 'react';
import { getAvailableTools, toggleChatTools, setDefaultTools, getDefaultTools, getChatAgentConfig } from '@/python/api';
import type { ToolInfo } from '@/lib/types/chat';

export function useTools(chatId: string) {
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [activeToolIds, setActiveToolIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load available tools on mount
  useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await getAvailableTools();
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
          // No chat selected - load defaults for new chat
          const response = await getDefaultTools();
          setActiveToolIds(response.toolIds || []);
        } else {
          // Load this chat's specific tools from its agent_config
          try {
            const config = await getChatAgentConfig({ body: { id: chatId } });
            setActiveToolIds(config.toolIds || []);
          } catch (error) {
            console.error('Failed to load chat config:', error);
            // Fallback to defaults
            const response = await getDefaultTools();
            setActiveToolIds(response.toolIds || []);
          }
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
        await toggleChatTools({ body: { chatId, toolIds: newActiveToolIds } });
      }

      // Always save as defaults for future chats
      await setDefaultTools({ body: { toolIds: newActiveToolIds } });
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

