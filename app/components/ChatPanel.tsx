"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ChatInputForm from "@/components/ChatInputForm";
import ThinkingTagPrompt from "@/components/ThinkingTagPrompt";
import { useChat } from "@/contexts/chat-context";
import { useChatInput } from "@/components/Chat";
import { api } from "@/lib/services/api";
import { getModelSettings } from "@/python/apiClient";

// Keep Chat itself dynamically imported as in the page to avoid SSR issues
const Chat = dynamic(() => import("@/components/Chat"), { ssr: false });

/**
 * ChatPanel isolates the frequently-updating streaming state
 * so the rest of the page (sidebar/header) doesn't re-render
 * on every token.
 */
export default function ChatPanel() {
  const { selectedModel, setSelectedModel, models } = useChat();
  const [showThinkingPrompt, setShowThinkingPrompt] = useState(false);
  const [hasCheckedThinkingPrompt, setHasCheckedThinkingPrompt] = useState(false);
  const [modelSettings, setModelSettings] = useState<any>(null);

  // Load model settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getModelSettings();
        setModelSettings(settings);
      } catch (error) {
        console.error('Failed to load model settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Callback for when thinking tags are detected during streaming
  const handleThinkTagDetected = useCallback(() => {
    if (hasCheckedThinkingPrompt) return;
    
    // Parse the current model
    const [provider, modelId] = selectedModel?.split(':') || [];
    if (!provider || !modelId || !modelSettings) return;
    
    // Find the model settings
    const setting = modelSettings.models?.find(
      (m: any) => m.provider === provider && m.modelId === modelId
    );
    
    // Check if we should show the prompt
    const alreadyParsing = setting?.parseThinkTags === true;
    const alreadyPrompted = setting?.thinkingTagPrompted?.prompted === true;
    
    if (!alreadyParsing && !alreadyPrompted) {
      setShowThinkingPrompt(true);
    }
    
    setHasCheckedThinkingPrompt(true);
  }, [hasCheckedThinkingPrompt, selectedModel, modelSettings]);

  // Reset the prompt check when switching models or chats
  useEffect(() => {
    setHasCheckedThinkingPrompt(false);
    setShowThinkingPrompt(false);
  }, [selectedModel]);

  // Handle user accepting the prompt
  const handleAcceptThinkingPrompt = useCallback(async () => {
    const [provider, modelId] = selectedModel?.split(':') || [];
    if (!provider || !modelId) return;
    
    try {
      await api.respondToThinkingTagPrompt(provider, modelId, true);
      setShowThinkingPrompt(false);
      
      // Reload model settings
      const settings = await getModelSettings();
      setModelSettings(settings);
    } catch (error) {
      console.error('Failed to accept thinking tag prompt:', error);
    }
  }, [selectedModel]);

  // Handle user declining the prompt
  const handleDeclineThinkingPrompt = useCallback(async () => {
    const [provider, modelId] = selectedModel?.split(':') || [];
    if (!provider || !modelId) return;
    
    try {
      await api.respondToThinkingTagPrompt(provider, modelId, false);
      setShowThinkingPrompt(false);
      
      // Reload model settings
      const settings = await getModelSettings();
      setModelSettings(settings);
    } catch (error) {
      console.error('Failed to decline thinking tag prompt:', error);
    }
  }, [selectedModel]);

  // Handle dismissing the prompt without responding
  const handleDismissThinkingPrompt = useCallback(() => {
    setShowThinkingPrompt(false);
  }, []);

  // Own streaming + input state locally inside this subtree
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
  } = useChatInput(handleThinkTagDetected);

  // Provide stable callback wrappers so siblings like ChatInputForm
  // don't re-render on every token just because handler identity changes.
  const submitRef = useRef(handleSubmit);
  const changeRef = useRef(handleInputChange);
  useEffect(() => { submitRef.current = handleSubmit; }, [handleSubmit]);
  useEffect(() => { changeRef.current = handleInputChange; }, [handleInputChange]);

  const stableHandleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    return submitRef.current(e);
  }, []);

  const stableHandleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    return changeRef.current(e);
  }, []);

  // Stable getModelName so it doesn't force re-renders
  // Model IDs are shown directly; no extra metadata
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
      // Skip during IME composition
      if (isComposing || e.isComposing) return;
      
      const activeElement = document.activeElement;
      
      // Don't trigger if an input/textarea/contentEditable is focused
      const isInputFocused = activeElement?.tagName === 'INPUT' || 
                            activeElement?.tagName === 'TEXTAREA' ||
                            activeElement?.getAttribute('contenteditable') === 'true';
      
      // Don't trigger if text is selected
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim().length > 0;
      
      // Don't trigger if modifiers are pressed (keyboard shortcuts)
      const hasModifiers = e.metaKey || e.ctrlKey || e.altKey;
      
      // Don't trigger for special keys
      const specialKeys = [
        'Escape', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        'PrintScreen', 'ScrollLock', 'Pause', 'Pause'
      ];
      const isSpecialKey = specialKeys.includes(e.key);
      
      // Only trigger for single printable characters
      const isPrintableKey = e.key.length === 1 && !isSpecialKey;
      
      // Check if chat input is already focused
      const isChatInputFocused = activeElement === inputRef.current;
      
      // Skip if any exclusion condition is met
      if (isInputFocused || hasSelection || hasModifiers || !isPrintableKey || isChatInputFocused) {
        return;
      }
      
      // Focus the textarea and simulate typing
      const textarea = inputRef.current;
      if (!textarea) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // Focus the textarea first to ensure selection properties are available
      textarea.focus();
      
      // Get cursor position (will be at end if not previously focused)
      const start = textarea.selectionStart ?? input.length;
      const end = textarea.selectionEnd ?? input.length;
      const currentValue = input;
      const newValue = currentValue.slice(0, start) + e.key + currentValue.slice(end);
      
      // Update input value
      const syntheticEvent = {
        target: { value: newValue },
      } as React.ChangeEvent<HTMLTextAreaElement>;
      
      handleInputChange(syntheticEvent);
      
      // Set cursor position after the inserted character
      requestAnimationFrame(() => {
        const newPosition = start + 1;
        textarea.setSelectionRange(newPosition, newPosition);
      });
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('compositionstart', handleCompositionStart);
    window.addEventListener('compositionend', handleCompositionEnd);
    
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('compositionstart', handleCompositionStart);
      window.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [canSendMessage, input, inputRef, handleInputChange]);

  return (
    <>
      <div className="overflow-y-scroll flex-1">
        <div className="top-0 right-8 sticky h-4 bg-gradient-to-b dark:from-[#30242A] from-[#FFFBF5] to-transparent z-20" />
        <div className="flex flex-col">
          <Chat
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
        />
      </div>
      {showThinkingPrompt && (
        <ThinkingTagPrompt
          onAccept={handleAcceptThinkingPrompt}
          onDecline={handleDeclineThinkingPrompt}
          onDismiss={handleDismissThinkingPrompt}
        />
      )}
    </>
  );
}
