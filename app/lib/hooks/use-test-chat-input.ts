"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useAgentTestChat } from "@/contexts/agent-test-chat-context";
import { useMessageEditing } from "@/lib/hooks/use-message-editing";
import { createUserMessage, createAssistantMessage } from "@/lib/utils/message";
import { api } from "@/lib/services/api";
import { processMessageStream } from "@/lib/services/stream-processor";
import type { Attachment, Message, MessageSibling } from "@/lib/types/chat";

export function useTestChatInput(agentId: string) {
  const { clearLastExecution, clearRunningExecution, recordFlowEvent } = useAgentTestChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const editing = useMessageEditing();
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<(() => void) | null>(null);
  const stopRequestedRef = useRef(false);

  const messageSiblings = useMemo<Record<string, MessageSibling[]>>(() => ({}), []);
  const canSendMessage = useMemo(() => !isLoading, [isLoading]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    editing.clearEditing();
    clearLastExecution();
  }, [clearLastExecution, editing]);

  const runStream = useCallback(
    async (allMessages: Message[]) => {
      setIsLoading(true);
      try {
        const { response, abort } = api.streamAgentChat(agentId, allMessages, undefined, true);
        streamAbortRef.current = abort;
        if (!response.ok) throw new Error(`Stream failed: ${response.statusText}`);

        let assistantMsgId: string | null = null;

        const result = await processMessageStream(response, {
          onUpdate: (content) => {
            if (assistantMsgId) {
              setMessages((prev) => {
                const withoutStreaming = prev.filter((m) => m.id !== assistantMsgId);
                return [
                  ...withoutStreaming,
                  { id: assistantMsgId!, role: "assistant", content, isComplete: false, sequence: 1 },
                ];
              });
            }
          },
          onSessionId: () => {},
          onMessageId: (id) => {
            assistantMsgId = id;
            streamingMessageIdRef.current = id;
          },
          onEvent: (eventType, payload) => {
            if (stopRequestedRef.current) return;
            recordFlowEvent(eventType, payload);
          },
        });

        if (result.messageId && result.finalContent.length > 0) {
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => m.id !== result.messageId);
            return [
              ...withoutStreaming,
              { id: result.messageId!, role: "assistant", content: result.finalContent, isComplete: true, sequence: 1 },
            ];
          });
        }
      } catch (error) {
        console.error("Agent stream error:", error);
        setMessages((prev) => [
          ...prev,
          createAssistantMessage([{ type: "error", content: String(error) }]),
        ]);
      } finally {
        setIsLoading(false);
        streamingMessageIdRef.current = null;
        streamAbortRef.current = null;
        if (stopRequestedRef.current) {
          clearRunningExecution();
          stopRequestedRef.current = false;
        }
      }
    },
    [agentId, clearRunningExecution, recordFlowEvent],
  );

  const handleSubmit = useCallback(
    async (inputText: string, attachments: Attachment[], toolIds?: string[]) => {
      void toolIds;
      if (!inputText.trim() && attachments.length === 0) return;
      if (isLoading) return;
      stopRequestedRef.current = false;

      const userMsg = createUserMessage(inputText.trim(), attachments);
      const allMessages = [...messages, userMsg];
      setMessages(allMessages);

      await runStream(allMessages);
    },
    [isLoading, messages, runStream],
  );

  const handleStop = useCallback(async () => {
    const messageId = streamingMessageIdRef.current;
    stopRequestedRef.current = true;
    clearRunningExecution();

    streamAbortRef.current?.();
    streamAbortRef.current = null;

    if (messageId) {
      try {
        await api.cancelRun(messageId);
      } catch (error) {
        console.error("Error cancelling run:", error);
      }
    }

    setIsLoading(false);
    streamingMessageIdRef.current = null;
  }, [clearRunningExecution]);

  const handleContinue = useCallback(async (messageId: string) => {
    void messageId;
  }, []);

  const handleRetry = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const trimmed = messages.slice(0, idx);
      setMessages(trimmed);

      const lastUserIdx = trimmed.length - 1;
      if (lastUserIdx >= 0 && trimmed[lastUserIdx].role === "user") {
        await runStream(trimmed);
      }
    },
    [messages, runStream],
  );

  const handleEdit = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (msg) editing.startEditing(msg);
    },
    [messages, editing],
  );

  const handleEditSubmit = useCallback(async () => {
    const messageId = editing.editingMessageId;
    const newContent = editing.editingDraft.trim();
    if (!messageId || (!newContent && editing.editingAttachments.length === 0)) return;

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const updatedUser = createUserMessage(
      newContent,
      editing.editingAttachments.length > 0 ? editing.editingAttachments : undefined,
    );
    const allMessages = [...messages.slice(0, idx), updatedUser];
    setMessages(allMessages);
    editing.clearEditing();

    await runStream(allMessages);
  }, [editing, messages, runStream]);

  const handleNavigate = useCallback(async (messageId: string, siblingId: string) => {
    void messageId;
    void siblingId;
  }, []);

  return {
    messages,
    isLoading,
    canSendMessage,
    messageSiblings,
    chatId: null as string | null,
    handleSubmit,
    handleStop,
    handleContinue,
    handleRetry,
    handleEdit,
    editingMessageId: editing.editingMessageId,
    editingDraft: editing.editingDraft,
    setEditingDraft: editing.setEditingDraft,
    handleEditCancel: editing.clearEditing,
    handleEditSubmit,
    handleNavigate,
    editingAttachments: editing.editingAttachments,
    addEditingAttachment: editing.addAttachment,
    removeEditingAttachment: editing.removeAttachment,
    clearMessages,
  };
}
