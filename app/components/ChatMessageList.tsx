import React, { useEffect, useRef, useCallback } from "react";
import ChatMessage from "./Message";
import { Message, MessageSibling, Attachment, PendingAttachment } from "@/lib/types/chat";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { FileDropZone, FileDropZoneTrigger } from "@/components/ui/file-drop-zone";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface ChatMessageListProps {
  messages: Message[];
  isLoading: boolean;
  messageSiblings: Record<string, MessageSibling[]>;
  onContinue?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onEditStart?: (messageId: string) => void;
  editingMessageId?: string | null;
  editingDraft?: string;
  setEditingDraft?: (val: string) => void;
  onEditCancel?: () => void;
  onEditSubmit?: () => void;
  onNavigate?: (messageId: string, siblingId: string) => void;
  actionLoading?: string | null;
  editingAttachments?: (Attachment | PendingAttachment)[];
  onAddEditingAttachment?: (file: File) => void;
  onRemoveEditingAttachment?: (id: string) => void;
}

interface MessageRowProps {
  message: Message;
  siblings: MessageSibling[];
  isStreaming: boolean;
  isLastAssistantMessage: boolean;
  isLoading: boolean;
  onContinue?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onEditStart?: (messageId: string) => void;
  onNavigate?: (messageId: string, siblingId: string) => void;
}

const MessageRow = React.memo(function MessageRow({
  message,
  siblings,
  isStreaming,
  isLastAssistantMessage,
  isLoading,
  onContinue,
  onRetry,
  onEditStart,
  onNavigate,
}: MessageRowProps) {
  const handleContinue = useCallback(() => {
    onContinue?.(message.id);
  }, [onContinue, message.id]);

  const handleRetry = useCallback(() => {
    onRetry?.(message.id);
  }, [onRetry, message.id]);

  const handleEdit = useCallback(() => {
    onEditStart?.(message.id);
  }, [onEditStart, message.id]);

  const handleNavigate = useCallback((siblingId: string) => {
    onNavigate?.(message.id, siblingId);
  }, [onNavigate, message.id]);

  return (
    <div>
      <ChatMessage
        role={message.role as "user" | "assistant"}
        content={message.content}
        isStreaming={isStreaming}
        message={message}
        siblings={siblings}
        onContinue={message.role === "assistant" && onContinue ? handleContinue : undefined}
        onRetry={message.role === "assistant" && onRetry ? handleRetry : undefined}
        onEdit={message.role === "user" && onEditStart ? handleEdit : undefined}
        onNavigate={onNavigate ? handleNavigate : undefined}
        isLoading={isLoading}
        isLastAssistantMessage={isLastAssistantMessage}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.attachments?.length === nextProps.message.attachments?.length &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isLastAssistantMessage === nextProps.isLastAssistantMessage &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.siblings.length === nextProps.siblings.length &&

    prevProps.onContinue === nextProps.onContinue &&
    prevProps.onRetry === nextProps.onRetry &&
    prevProps.onEditStart === nextProps.onEditStart &&
    prevProps.onNavigate === nextProps.onNavigate
  );
});

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  isLoading,
  messageSiblings,
  onContinue,
  onRetry,
  onEditStart,
  editingMessageId,
  editingDraft = "",
  setEditingDraft,
  onEditCancel,
  onEditSubmit,
  onNavigate,
  actionLoading,
  editingAttachments = [],
  onAddEditingAttachment,
  onRemoveEditingAttachment,
}) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(messages.length);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const bottomElement = endOfMessagesRef.current;
    if (!bottomElement) return;

    const scrollContainer =
      bottomElement.parentElement?.parentElement?.parentElement;
    if (!scrollContainer) return;

    scrollContainerRef.current = scrollContainer;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isAtBottomRef.current = entry.isIntersecting;
      },
      {
        root: scrollContainer,
        threshold: 0,
        rootMargin: "100px",
      },
    );

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom > 70) {
        // console.log('not at bottom');
        isAtBottomRef.current = false;
      } else if (distanceFromBottom < 50) {
        // console.log('at bottom');
        isAtBottomRef.current = true;
      }
    };

    observer.observe(bottomElement);
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const userJustSentMessage =
      messages.length > prevMessagesLengthRef.current &&
      messages[messages.length - 1]?.role === "user";

    prevMessagesLengthRef.current = messages.length;

    const scrollToBottom = () => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        });
      });
    };

    if (userJustSentMessage) {
      scrollToBottom();
      isAtBottomRef.current = true;
    } else if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, isLoading]);

  const filteredMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // Find the last assistant message index
  const lastAssistantIndex = filteredMessages.reduce((lastIdx, m, idx) => {
    return m.role === "assistant" ? idx : lastIdx;
  }, -1);

  return (
    <>
      {filteredMessages.map((m, index) => {
        const siblings = messageSiblings[m.id] || [];
        const isStreamingMessage =
          isLoading &&
          index === filteredMessages.length - 1 &&
          m.role === "assistant";
        const isLastAssistantMessage =
          !isLoading && index === lastAssistantIndex && m.role === "assistant";

        // Inline editor for user message being edited
        if (
          m.role === "user" &&
          editingMessageId &&
          m.id === editingMessageId
        ) {
          return (
            <div key={m.id} className="flex w-full justify-end group/message">
              <div className="relative mb-2 max-w-[50rem] w-full">
                <UserMessageEditor
                  value={editingDraft}
                  onChange={(val) => setEditingDraft && setEditingDraft(val)}
                  onCancel={onEditCancel}
                  onSubmit={onEditSubmit}
                  attachments={editingAttachments}
                  onAddAttachment={onAddEditingAttachment}
                  onRemoveAttachment={onRemoveEditingAttachment}
                  isLoading={isLoading}
                />
              </div>
            </div>
          );
        }

        return (
          <MessageRow
            key={m.id}
            message={m}
            siblings={siblings}
            isStreaming={isStreamingMessage}
            isLastAssistantMessage={isLastAssistantMessage}
            isLoading={actionLoading === m.id}
            onContinue={onContinue}
            onRetry={onRetry}
            onEditStart={onEditStart}
            onNavigate={onNavigate}
          />
        );
      })}
      <div ref={endOfMessagesRef} className="h-8 -mt-" />
    </>
  );
};

export default React.memo(ChatMessageList);

// Editor component for inline user message editing
function UserMessageEditor({
  value,
  onChange,
  onCancel,
  onSubmit,
  attachments = [],
  onAddAttachment,
  onRemoveAttachment,
  isLoading = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  attachments?: (Attachment | PendingAttachment)[];
  onAddAttachment?: (file: File) => void;
  onRemoveAttachment?: (id: string) => void;
  isLoading?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Focus and select all text
    ta.focus();
    ta.select();

    const adjust = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    };
    adjust();
    const ro = new ResizeObserver(adjust);
    ro.observe(ta);
    return () => ro.disconnect();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    },
    [onSubmit, onCancel],
  );

  const handleFilesDrop = useCallback(
    (files: File[]) => {
      if (!onAddAttachment) return;
      files.forEach((file) => {
        onAddAttachment(file);
      });
    },
    [onAddAttachment]
  );

  const canSubmit = value.trim() || attachments.length > 0;

  return (
    <FileDropZone
      onFilesDrop={handleFilesDrop}
      disabled={isLoading}
      className="w-full"
    >
      <div className="rounded-3xl bg-muted text-muted-foreground p-3">
        {/* Attachment preview */}
        {attachments.length > 0 && (
          <div className="w-full pb-2">
            <AttachmentPreview
              attachments={attachments}
              onRemove={onRemoveAttachment}
            />
          </div>
        )}

        <div className="w-full min-h-[40px] max-h-[200px]">
          <textarea
            ref={textareaRef}
            className="w-full border-none bg-transparent px-1 text-base shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={isLoading}
          />
        </div>
        <div className="flex items-center gap-2 pt-2 justify-between">
          <FileDropZoneTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 flex-shrink-0 rounded-full p-2"
              disabled={isLoading}
            >
              <Plus className="size-4" />
            </Button>
          </FileDropZoneTrigger>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded-full border border-border hover:bg-accent text-sm"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-8 px-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm disabled:opacity-50"
              onClick={onSubmit}
              disabled={!canSubmit || isLoading}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </FileDropZone>
  );
}
