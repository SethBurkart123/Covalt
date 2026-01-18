import { memo, useEffect, useRef, useCallback } from "react";
import ChatMessage from "./ChatMessage";
import { Message, MessageSibling, Attachment, PendingAttachment } from "@/lib/types/chat";
import ChatMessageEditor from "./ChatMessageEditor";

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
  chatId?: string;
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
  chatId?: string;
}

const MessageRow = memo(function MessageRow({
  message,
  siblings,
  isStreaming,
  isLastAssistantMessage,
  isLoading,
  onContinue,
  onRetry,
  onEditStart,
  onNavigate,
  chatId,
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
      chatId={chatId}
    />
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
    prevProps.chatId === nextProps.chatId &&

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
  chatId,
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
        isAtBottomRef.current = false;
      } else if (distanceFromBottom < 50) {
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

        if (
          m.role === "user" &&
          editingMessageId &&
          m.id === editingMessageId
        ) {
          return (
            <div key={m.id} className="flex w-full justify-end group/message">
              <div className="relative mb-2 max-w-[50rem] w-full">
                <ChatMessageEditor
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
            chatId={chatId}
          />
        );
      })}
      <div ref={endOfMessagesRef} className="h-8" />
    </>
  );
};

export default memo(ChatMessageList);