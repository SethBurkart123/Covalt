"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatInputForm from "@/components/ChatInputForm";
import ChatMessageList from "@/components/ChatMessageList";
import ThinkingTagPrompt from "@/components/ThinkingTagPrompt";
import { useChat } from "@/contexts/chat-context";
import { useChatInput } from "@/lib/hooks/use-chat-input";
import { api } from "@/lib/services/api";
import { getModelSettings } from "@/python/api";
import { Header } from "./Header";
import { ArtifactPanelProvider } from "@/contexts/artifact-panel-context";
import { ArtifactPanel } from "@/components/artifact-panel/ArtifactPanel";
import "@/components/tool-renderers";
import type { PendingAttachment } from "@/lib/types/chat";

export default function ChatPanel() {
  const { selectedModel, setSelectedModel, models, chatId } = useChat();
  const [showThinkingPrompt, setShowThinkingPrompt] = useState(false);
  const [hasCheckedThinkingPrompt, setHasCheckedThinkingPrompt] =
    useState(false);
  const [modelSettings, setModelSettings] = useState<any>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setModelSettings(await getModelSettings());
      } catch (error) {
        console.error("Failed to load model settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleThinkTagDetected = useCallback(() => {
    if (hasCheckedThinkingPrompt) return;

    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId || !modelSettings) return;

    const setting = modelSettings.models?.find(
      (m: any) => m.provider === provider && m.modelId === modelId,
    );

    if (
      setting?.parseThinkTags !== true &&
      setting?.thinkingTagPrompted?.prompted !== true
    ) {
      setShowThinkingPrompt(true);
    }

    setHasCheckedThinkingPrompt(true);
  }, [hasCheckedThinkingPrompt, selectedModel, modelSettings]);

  useEffect(() => {
    setHasCheckedThinkingPrompt(false);
    setShowThinkingPrompt(false);
  }, [selectedModel]);

  const {
    handleSubmit,
    isLoading,
    messages,
    canSendMessage,
    handleStop,
    handleContinue,
    handleRetry,
    handleEdit,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    handleEditCancel,
    handleEditSubmit,
    handleNavigate,
    messageSiblings,
    streamingMessageIdRef,
    triggerReload,
    // Editing attachment handlers
    editingAttachments,
    addEditingAttachment,
    removeEditingAttachment,
  } = useChatInput(handleThinkTagDetected);

  const handleAcceptThinkingPrompt = useCallback(async () => {
    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId) return;

    try {
      await api.respondToThinkingTagPrompt(provider, modelId, true);
      setShowThinkingPrompt(false);

      const messageId =
        streamingMessageIdRef.current ||
        messages.filter((m) => m.role === "assistant").pop()?.id;

      if (messageId && chatId) {
        if (!isLoading && streamingMessageIdRef.current) {
          console.log(`Reprocessing message ${messageId} to parse think tags`);
          if ((await api.reprocessMessageThinkTags(messageId)).success) {
            triggerReload();
          }
        }
      }

      setModelSettings(await getModelSettings());
    } catch (error) {
      console.error("Failed to accept thinking tag prompt:", error);
    }
  }, [
    selectedModel,
    streamingMessageIdRef,
    messages,
    chatId,
    isLoading,
    triggerReload,
  ]);

  const handleDeclineThinkingPrompt = useCallback(async () => {
    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId) return;

    try {
      await api.respondToThinkingTagPrompt(provider, modelId, false);
      setShowThinkingPrompt(false);
      setModelSettings(await getModelSettings());
    } catch (error) {
      console.error("Failed to decline thinking tag prompt:", error);
    }
  }, [selectedModel]);

  const handleDismissThinkingPrompt = useCallback(() => {
    setShowThinkingPrompt(false);
  }, []);

  // Create stable callback references using refs
  const submitRef = useRef(handleSubmit);
  const setSelectedModelRef = useRef(setSelectedModel);
  const handleStopRef = useRef(handleStop);

  useEffect(() => {
    submitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    setSelectedModelRef.current = setSelectedModel;
  }, [setSelectedModel]);

  useEffect(() => {
    handleStopRef.current = handleStop;
  }, [handleStop]);

  // Stable callbacks that never change reference
  const stableHandleSubmit = useCallback(
    (input: string, attachments: PendingAttachment[]) => {
      return submitRef.current(input, attachments);
    },
    [],
  );

  const stableSetSelectedModel = useCallback((model: string) => {
    return setSelectedModelRef.current(model);
  }, []);

  const stableHandleStop = useCallback(() => {
    return handleStopRef.current();
  }, []);

  // Memoize models array reference - only create new reference when models actually change
  const stableModels = useMemo(() => models, [models]);

  return (
    <ArtifactPanelProvider>
      <div className="flex flex-row min-h-full">
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <div className="overflow-y-scroll flex-1">
            <div className="top-0 right-8 sticky h-4 bg-gradient-to-b dark:from-[#30242A] from-[#FFFBF5] to-transparent z-20" />
            <div className="flex-1 px-4 py-6 max-w-[50rem] w-full mx-auto">
              <ChatMessageList
                messages={messages}
                isLoading={isLoading}
                messageSiblings={messageSiblings}
                onContinue={handleContinue}
                onRetry={handleRetry}
                onEditStart={handleEdit}
                editingMessageId={editingMessageId}
                editingDraft={editingDraft}
                setEditingDraft={setEditingDraft}
                onEditCancel={handleEditCancel}
                onEditSubmit={handleEditSubmit}
                onNavigate={handleNavigate}
                actionLoading={null}
                editingAttachments={editingAttachments}
                onAddEditingAttachment={addEditingAttachment}
                onRemoveEditingAttachment={removeEditingAttachment}
              />
            </div>
          </div>
          <div className="px-4 pb-4">
            <ChatInputForm
              onSubmit={stableHandleSubmit}
              isLoading={isLoading}
              selectedModel={selectedModel}
              setSelectedModel={stableSetSelectedModel}
              models={stableModels}
              canSendMessage={canSendMessage}
              onStop={stableHandleStop}
            />
          </div>
          {showThinkingPrompt && (
            <ThinkingTagPrompt
              onAccept={handleAcceptThinkingPrompt}
              onDecline={handleDeclineThinkingPrompt}
              onDismiss={handleDismissThinkingPrompt}
            />
          )}
        </div>
        <ArtifactPanel />
      </div>
    </ArtifactPanelProvider>
  );
}
