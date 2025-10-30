"use client";

import React, { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import ChatInputForm from "@/components/ChatInputForm";
import { useChat } from "@/contexts/chat-context";
import { useChatInput } from "@/components/Chat";

// Keep Chat itself dynamically imported as in the page to avoid SSR issues
const Chat = dynamic(() => import("@/components/Chat"), { ssr: false });

/**
 * ChatPanel isolates the frequently-updating streaming state
 * so the rest of the page (sidebar/header) doesn't re-render
 * on every token.
 */
export default function ChatPanel() {
  const { selectedModel, setSelectedModel, models } = useChat();

  // Own streaming + input state locally inside this subtree
  const { input, handleInputChange, handleSubmit, isLoading, inputRef, messages, canSendMessage, triggerReload, setMessages } = useChatInput();

  // Refresh messages callback for branch operations
  const handleRefreshMessages = useCallback(async () => {
    triggerReload();
  }, [triggerReload]);

  // Allow Chat component to update messages optimistically during streaming
  const handleUpdateMessages = useCallback((updater: (prev: any[]) => any[]) => {
    setMessages(updater);
  }, [setMessages]);

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

  return (
    <>
      <div className="overflow-y-scroll flex-1">
        <div className="top-0 right-8 sticky h-4 bg-gradient-to-b dark:from-[#30242A] from-[#FFFBF5] to-transparent z-20" />
        <div className="flex flex-col">
          <Chat
            messages={messages}
            isLoading={isLoading}
            onRefreshMessages={handleRefreshMessages}
            onUpdateMessages={handleUpdateMessages}
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
        />
      </div>
    </>
  );
}
