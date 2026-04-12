"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderOpen, ArrowDown } from "lucide-react";
import { motion } from "framer-motion";
import { useChat } from "@/contexts/chat-context";
import { usePageTitle } from "@/contexts/page-title-context";
import { ArtifactPanelProvider } from "@/contexts/artifact-panel-context";
import { useChatInput } from "@/lib/hooks/use-chat-input";
import { useModelOptions } from "@/lib/hooks/use-model-options";
import { api } from "@/lib/services/api";
import {
  shouldParseThinkTags,
  processMessageContent,
} from "@/lib/utils/think-tag-parser";
import { getModelSettings } from "@/python/api";
import ChatInputForm from "@/components/ChatInputForm";
import ChatMessageList from "@/components/ChatMessageList";
import ThinkingTagPrompt from "@/components/ThinkingTagPrompt";
import { Button } from "@/components/ui/button";
import { Header } from "./Header";
import { ArtifactPanel } from "@/components/artifact-panel/ArtifactPanel";
import { DevPanel } from "@/components/DevPanel";
import { WorkspaceBrowser } from "@/components/WorkspaceBrowser";
import "@/components/tool-renderers";
import type { AllModelSettingsResponse } from "@/python/api";
import type { Message } from "@/lib/types/chat";

const WORKSPACE_PANEL_TRANSITION = {
  type: "spring" as const,
  stiffness: 393,
  damping: 35,
};

function parseSelectedModel(
  model: string,
): { provider: string; modelId: string } | null {
  if (!model || model.startsWith("agent:")) return null;
  const separatorIndex = model.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= model.length - 1) return null;
  return {
    provider: model.slice(0, separatorIndex),
    modelId: model.slice(separatorIndex + 1),
  };
}

export default function ChatPanel() {
  const {
    selectedModel,
    setSelectedModel,
    models: availableModels,
    chatId,
    agents,
  } = useChat();
  const { setRightContent } = usePageTitle();
  const [showThinkingPrompt, setShowThinkingPrompt] = useState(false);
  const [modelSettings, setModelSettings] =
    useState<AllModelSettingsResponse | null>(null);
  const [workspaceFilesCount, setWorkspaceFilesCount] = useState(0);
  const [userRequestedOpen, setUserRequestedOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const prevSelectedModelRef = useRef(selectedModel);

  const hideToolSelector = useMemo(() => {
    if (!selectedModel.startsWith("agent:")) return false;
    const agentId = selectedModel.slice("agent:".length);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return true;
    return !agent.includeUserTools;
  }, [selectedModel, agents]);

  useEffect(() => {
    getModelSettings()
      .then(setModelSettings)
      .catch((error) => console.error("Failed to load model settings:", error));
  }, []);

  const hasCheckedThinkingPromptRef = useRef(false);

  if (prevSelectedModelRef.current !== selectedModel) {
    prevSelectedModelRef.current = selectedModel;
    hasCheckedThinkingPromptRef.current = false;
    setShowThinkingPrompt(false);
  }

  const handleThinkTagDetected = useCallback(() => {
    if (hasCheckedThinkingPromptRef.current) return;

    const parsedModel = parseSelectedModel(selectedModel);
    if (!parsedModel || !modelSettings) return;

    const { provider, modelId } = parsedModel;

    const setting = modelSettings.models?.find(
      (m) => m.provider === provider && m.modelId === modelId,
    );

    if (
      setting?.reasoning?.supports === true &&
      !setting?.thinkingTagPrompted?.declined
    ) {
      hasCheckedThinkingPromptRef.current = true;
      return;
    }

    if (
      setting?.parseThinkTags !== true &&
      setting?.thinkingTagPrompted?.prompted !== true
    ) {
      setShowThinkingPrompt(true);
    }

    hasCheckedThinkingPromptRef.current = true;
  }, [selectedModel, modelSettings]);

  const isWorkspaceOpen =
    chatId != null && workspaceFilesCount > 0 && userRequestedOpen;

  const workspaceButton = useMemo(() => {
    if (workspaceFilesCount <= 0) return null;
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => setUserRequestedOpen((prev) => !prev)}
        aria-label={isWorkspaceOpen ? "Close workspace" : "Open workspace"}
      >
        {isWorkspaceOpen ? (
          <FolderOpen className="size-4" />
        ) : (
          <Folder className="size-4" />
        )}
      </Button>
    );
  }, [workspaceFilesCount, isWorkspaceOpen]);

  useEffect(() => {
    setRightContent(workspaceButton);
    return () => setRightContent(null);
  }, [workspaceButton, setRightContent]);

  const {
    schema: modelOptionSchema,
    values: modelOptionValues,
    setValue: setModelOptionValue,
    reset: resetModelOptions,
    getVisibleValues: getVisibleModelOptions,
  } = useModelOptions(selectedModel, availableModels);

  const {
    handleSubmit,
    isLoading,
    messages: rawMessages,
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
    editingAttachments,
    addEditingAttachment,
    removeEditingAttachment,
  } = useChatInput(handleThinkTagDetected, getVisibleModelOptions);

  const messages = useMemo(() => {
    if (!modelSettings?.models) return rawMessages;

    return rawMessages.map((msg): Message => {
      if (msg.role !== "assistant") return msg;

      const modelKey = msg.modelUsed || selectedModel;
      if (!modelKey) return msg;

      const shouldParse = shouldParseThinkTags(modelKey, modelSettings.models);
      return shouldParse
        ? { ...msg, content: processMessageContent(msg.content, shouldParse) }
        : msg;
    });
  }, [rawMessages, modelSettings, selectedModel]);

  const handleAcceptThinkingPrompt = useCallback(async () => {
    const parsedModel = parseSelectedModel(selectedModel);
    if (!parsedModel) return;

    await api.respondToThinkingTagPrompt(
      parsedModel.provider,
      parsedModel.modelId,
      true,
    );
    setShowThinkingPrompt(false);

    if (!isLoading && streamingMessageIdRef.current) triggerReload();

    setModelSettings(await getModelSettings());
  }, [selectedModel, streamingMessageIdRef, isLoading, triggerReload]);

  const handleDeclineThinkingPrompt = useCallback(async () => {
    const parsedModel = parseSelectedModel(selectedModel);
    if (!parsedModel) return;

    await api.respondToThinkingTagPrompt(
      parsedModel.provider,
      parsedModel.modelId,
      false,
    );
    setShowThinkingPrompt(false);
    setModelSettings(await getModelSettings());
  }, [selectedModel]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const handleScrollToBottom = useCallback(() => {
    scrollToBottomRef.current?.();
  }, []);

  const chatInputForm = (
    <ChatInputForm
      onSubmit={handleSubmit}
      isLoading={isLoading}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      models={availableModels}
      optionSchema={modelOptionSchema}
      optionValues={modelOptionValues}
      onOptionChange={setModelOptionValue}
      onResetOptions={resetModelOptions}
      canSendMessage={canSendMessage}
      onStop={handleStop}
      hideToolSelector={hideToolSelector}
    />
  );

  return (
    <ArtifactPanelProvider>
      <div className="flex flex-row min-h-full">
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          {!(messages.length === 0 && !chatId) ? (
            <>
              <div
                ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
                className="overflow-y-scroll flex-1"
              >
                <div className="top-0 right-8 sticky h-4 z-20 pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black,transparent)]">
                  <div className="absolute inset-0 bg-sidebar" />
                  <div className="absolute inset-0 dark:bg-card/30 bg-background dark:block" />
                </div>
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
                    chatId={chatId ?? undefined}
                    scrollContainerRef={scrollContainerRef}
                    onFollowingChange={setIsFollowing}
                    onScrollToBottomRef={scrollToBottomRef}
                  />
                </div>
              </div>
              <div className="relative px-4 pb-4">
                {!isFollowing && isLoading && (
                  <div className="absolute left-1/2 -translate-x-1/2 -top-12 z-30">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-full before:rounded-full shadow-md bg-background/80 backdrop-blur-sm border-border/60 hover:bg-accent"
                      onClick={handleScrollToBottom}
                      aria-label="Scroll to bottom"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                  </div>
                )}
                {chatInputForm}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4">
              <h1 className="text-4xl mb-8 text-muted-foreground">
                {getGreeting()}.
              </h1>
              <div className="w-full max-w-4xl">{chatInputForm}</div>
            </div>
          )}
          {showThinkingPrompt && (
            <ThinkingTagPrompt
              onAccept={handleAcceptThinkingPrompt}
              onDecline={handleDeclineThinkingPrompt}
              onDismiss={() => setShowThinkingPrompt(false)}
            />
          )}
        </div>
        <ArtifactPanel />
        {chatId && (
          <motion.div
            className="overflow-hidden h-full shrink-0"
            initial={false}
            animate={{ width: isWorkspaceOpen ? 320 : 0 }}
            transition={WORKSPACE_PANEL_TRANSITION}
          >
            <div className="h-full w-80 min-w-80 border-l bg-card/40">
              <WorkspaceBrowser
                chatId={chatId}
                className="h-full"
                onFilesCountChange={setWorkspaceFilesCount}
              />
            </div>
          </motion.div>
        )}
        {process.env.NODE_ENV === "development" && (
          <DevPanel isLoading={isLoading} canSendMessage={canSendMessage} />
        )}
      </div>
    </ArtifactPanelProvider>
  );
}
