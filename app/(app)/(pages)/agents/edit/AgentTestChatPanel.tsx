"use client";

import { useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useAgentTestChat } from "@/contexts/agent-test-chat-context";
import { useAgentEditor } from "@/contexts/agent-editor-context";
import { ArtifactPanelProvider, useArtifactPanel } from "@/contexts/artifact-panel-context";
import { useTestChatInput } from "@/lib/hooks/use-test-chat-input";
import { useResizePanel } from "@/lib/hooks/use-resize-panel";
import { usePageTitle } from "@/contexts/page-title-context";
import { Button } from "@/components/ui/button";
import ChatMessageList from "@/components/ChatMessageList";
import ChatInputForm from "@/components/ChatInputForm";
import { ArtifactPanel } from "@/components/artifact-panel/ArtifactPanel";
import { cn } from "@/lib/utils";
import "@/components/tool-renderers";

const TRANSITION = {
  type: "spring" as const,
  stiffness: 231,
  damping: 28,
};

function TestChatInner() {
  const { isOpen, close } = useAgentTestChat();
  const { agentId } = useAgentEditor();
  const { setRightOffset } = usePageTitle();
  const chat = useTestChatInput(agentId);
  const { isOpen: artifactOpen } = useArtifactPanel();

  const { containerRef, width, isResizing, handleResizeStart } = useResizePanel({
    defaultWidth: 420,
    minWidth: 320,
    maxWidth: artifactOpen ? 1200 : 700,
  });

  const effectiveWidth = artifactOpen ? Math.max(width, 800) : width;

  useEffect(() => {
    setRightOffset(isOpen ? effectiveWidth : 0);
    return () => setRightOffset(0);
  }, [isOpen, effectiveWidth, setRightOffset]);

  const stableHandleSubmit = useCallback(
    (input: string, attachments: Parameters<typeof chat.handleSubmit>[1]) => {
      chat.handleSubmit(input, attachments);
    },
    [chat.handleSubmit]
  );

  return (
    <motion.div
      ref={containerRef}
      className="overflow-hidden h-full shrink-0"
      initial={false}
      animate={{ width: isOpen ? effectiveWidth : 0 }}
      transition={isResizing ? { duration: 0 } : TRANSITION}
    >
      <div
        className="h-full bg-card/80 backdrop-blur-sm border-l border-border rounded-l-xl overflow-hidden relative"
        style={{ width: effectiveWidth }}
      >
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/20 transition-colors z-10",
            isResizing && "bg-primary/30"
          )}
          onMouseDown={handleResizeStart}
        />

        <div className="flex flex-row h-full">
          <div className={cn(
            "flex flex-col overflow-hidden min-w-0",
            artifactOpen ? "w-1/2" : "flex-1",
          )}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">Test Chat</h3>
                {chat.messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={chat.clearMessages}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={close}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {chat.messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm px-4">
                  <p>Send a message to test the agent</p>
                </div>
              ) : (
                <div className="px-4 py-4">
                  <ChatMessageList
                    messages={chat.messages}
                    isLoading={chat.isLoading}
                    messageSiblings={chat.messageSiblings}
                    onContinue={chat.handleContinue}
                    onRetry={chat.handleRetry}
                    onEditStart={chat.handleEdit}
                    editingMessageId={chat.editingMessageId}
                    editingDraft={chat.editingDraft}
                    setEditingDraft={chat.setEditingDraft}
                    onEditCancel={chat.handleEditCancel}
                    onEditSubmit={chat.handleEditSubmit}
                    onNavigate={chat.handleNavigate}
                    actionLoading={null}
                    editingAttachments={chat.editingAttachments}
                    onAddEditingAttachment={chat.addEditingAttachment}
                    onRemoveEditingAttachment={chat.removeEditingAttachment}
                    chatId={chat.chatId ?? undefined}
                  />
                </div>
              )}
            </div>

            <div className="px-3 pb-3 shrink-0">
              <ChatInputForm
                onSubmit={stableHandleSubmit}
                isLoading={chat.isLoading}
                selectedModel=""
                setSelectedModel={() => {}}
                models={[]}
                canSendMessage={chat.canSendMessage}
                onStop={chat.handleStop}
                hideModelSelector
                hideToolSelector
              />
            </div>
          </div>

          <ArtifactPanel />
        </div>
      </div>
    </motion.div>
  );
}

export function AgentTestChatPanel() {
  return (
    <ArtifactPanelProvider>
      <TestChatInner />
    </ArtifactPanelProvider>
  );
}
