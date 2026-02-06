"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { ArtifactPanelProvider } from "@/contexts/artifact-panel-context";
import { useChatInput } from "@/lib/hooks/use-chat-input";
import { api } from "@/lib/services/api";
import { shouldParseThinkTags, processMessageContent } from "@/lib/utils/think-tag-parser";
import { getModelSettings } from "@/python/api";
import ChatInputForm from "@/components/ChatInputForm";
import ChatMessageList from "@/components/ChatMessageList";
import ThinkingTagPrompt from "@/components/ThinkingTagPrompt";
import { Header } from "./Header";
import { ArtifactPanel } from "@/components/artifact-panel/ArtifactPanel";
import { DevPanel } from "@/components/DevPanel";
import "@/components/tool-renderers";
import type { AllModelSettingsResponse, AgentInfo } from "@/python/api";
import type { Attachment, Message } from "@/lib/types/chat";

export default function ChatPanel() {
  const { selectedModel, setSelectedModel, models: availableModels, chatId } = useChat();
  const [showThinkingPrompt, setShowThinkingPrompt] = useState(false);
  const [hasCheckedThinkingPrompt, setHasCheckedThinkingPrompt] =
    useState(false);
  const [modelSettings, setModelSettings] = useState<AllModelSettingsResponse | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const handleAgentsLoaded = useCallback((loaded: AgentInfo[]) => {
    setAgents(loaded);
  }, []);

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

  const handleThinkTagDetected = useCallback(() => {
    if (hasCheckedThinkingPrompt) return;

    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId || !modelSettings) return;

    const setting = modelSettings.models?.find(
      (m) => m.provider === provider && m.modelId === modelId
    );

    if (setting?.parseThinkTags !== true && setting?.thinkingTagPrompted?.prompted !== true) {
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
  } = useChatInput(handleThinkTagDetected);

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
    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId) return;

    await api.respondToThinkingTagPrompt(provider, modelId, true);
    setShowThinkingPrompt(false);

    if (!isLoading && streamingMessageIdRef.current) triggerReload();

    setModelSettings(await getModelSettings());
  }, [selectedModel, streamingMessageIdRef, isLoading, triggerReload]);

  const handleDeclineThinkingPrompt = useCallback(async () => {
    const [provider, modelId] = selectedModel?.split(":") || [];
    if (!provider || !modelId) return;

    await api.respondToThinkingTagPrompt(provider, modelId, false);
    setShowThinkingPrompt(false);
    setModelSettings(await getModelSettings());
  }, [selectedModel]);

  const submitRef = useRef(handleSubmit);
  const setSelectedModelRef = useRef(setSelectedModel);
  const handleStopRef = useRef(handleStop);

  useEffect(() => { submitRef.current = handleSubmit; }, [handleSubmit]);
  useEffect(() => { setSelectedModelRef.current = setSelectedModel; }, [setSelectedModel]);
  useEffect(() => { handleStopRef.current = handleStop; }, [handleStop]);

  const stableHandleSubmit = useCallback((input: string, attachments: Attachment[]) => 
    submitRef.current(input, attachments), []);

  const stableSetSelectedModel = useCallback((model: string) => 
    setSelectedModelRef.current(model), []);

  const stableHandleStop = useCallback(() => 
    handleStopRef.current(), []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  return (
    <ArtifactPanelProvider>
      <div className="flex flex-row min-h-full">
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          {!(messages.length === 0 && !chatId) ? (
            <>
              <div className="overflow-y-scroll flex-1">
                <div
                  className="top-0 right-8 sticky h-4 z-20 pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black,transparent)]"
                >
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
                  />
                </div>
              </div>
              <div className="px-4 pb-4">
                <ChatInputForm
                  onSubmit={stableHandleSubmit}
                  isLoading={isLoading}
                  selectedModel={selectedModel}
                  setSelectedModel={stableSetSelectedModel}
                  models={availableModels}
                  canSendMessage={canSendMessage}
                  onStop={stableHandleStop}
                  hideToolSelector={hideToolSelector}
                  onAgentsLoaded={handleAgentsLoaded}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4">
              <h1 className="text-4xl mb-8 text-muted-foreground">
                {getGreeting()}.
              </h1>
              <div className="w-full max-w-4xl">
                <ChatInputForm
                  onSubmit={stableHandleSubmit}
                  isLoading={isLoading}
                  selectedModel={selectedModel}
                  setSelectedModel={stableSetSelectedModel}
                  models={availableModels}
                  canSendMessage={canSendMessage}
                  onStop={stableHandleStop}
                  hideToolSelector={hideToolSelector}
                  onAgentsLoaded={handleAgentsLoaded}
                />
              </div>
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
        {process.env.NODE_ENV === "development" && (
          <DevPanel isLoading={isLoading} canSendMessage={canSendMessage} />
        )}
      </div>
    </ArtifactPanelProvider>
  );
}
