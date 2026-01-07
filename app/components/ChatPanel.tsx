"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    inputRef,
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
    // Attachment handlers
    pendingAttachments,
    addAttachment,
    removeAttachment,
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

  const submitRef = useRef(handleSubmit);
  const changeRef = useRef(handleInputChange);
  useEffect(() => {
    submitRef.current = handleSubmit;
  }, [handleSubmit]);
  useEffect(() => {
    changeRef.current = handleInputChange;
  }, [handleInputChange]);

  const stableHandleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      return submitRef.current(e);
    },
    [],
  );

  const stableHandleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      return changeRef.current(e);
    },
    [],
  );

  const getModelName = useCallback((id: string) => id, []);

  useEffect(() => {
    if (!canSendMessage) return;

    let isComposing = false;

    const handleCompositionStart = () => {
      isComposing = true;
    };

    const handleCompositionEnd = () => {
      isComposing = false;
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isComposing || e.isComposing) return;

      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.getAttribute("contenteditable") === "true";

      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim().length > 0;
      const hasModifiers = e.metaKey || e.ctrlKey || e.altKey;

      const specialKeys = [
        "Escape",
        "Tab",
        "Enter",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Insert",
        "Delete",
        "Backspace",
        "F1",
        "F2",
        "F3",
        "F4",
        "F5",
        "F6",
        "F7",
        "F8",
        "F9",
        "F10",
        "F11",
        "F12",
        "PrintScreen",
        "ScrollLock",
        "Pause",
      ];
      const isPrintableKey =
        e.key.length === 1 && !specialKeys.includes(e.key);

      if (
        isInputFocused ||
        hasSelection ||
        hasModifiers ||
        !isPrintableKey ||
        activeElement === inputRef.current
      ) {
        return;
      }

      const textarea = inputRef.current;
      if (!textarea) return;

      e.preventDefault();
      e.stopPropagation();
      textarea.focus();

      const start = textarea.selectionStart ?? input.length;
      const end = textarea.selectionEnd ?? input.length;
      const newValue = input.slice(0, start) + e.key + input.slice(end);

      handleInputChange({
        target: { value: newValue },
      } as React.ChangeEvent<HTMLTextAreaElement>);

      requestAnimationFrame(() => {
        textarea.setSelectionRange(start + 1, start + 1);
      });
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("compositionstart", handleCompositionStart);
    window.addEventListener("compositionend", handleCompositionEnd);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("compositionstart", handleCompositionStart);
      window.removeEventListener("compositionend", handleCompositionEnd);
    };
  }, [canSendMessage, input, inputRef, handleInputChange]);

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
              input={input}
              handleInputChange={stableHandleInputChange}
              handleSubmit={stableHandleSubmit}
              isLoading={isLoading}
              inputRef={inputRef}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              models={models}
              getModelName={getModelName}
              canSendMessage={canSendMessage}
              onStop={handleStop}
              attachments={pendingAttachments}
              onAddAttachment={addAttachment}
              onRemoveAttachment={removeAttachment}
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
