import React, { useEffect, useRef, useCallback } from "react";
import ChatMessage from "./Message";
import { Message, MessageSibling } from "@/lib/types/chat";

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
}

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

    if (userJustSentMessage && endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      isAtBottomRef.current = true;
    } else if (isAtBottomRef.current && endOfMessagesRef.current) {
      // console.log('scrolling to bottom');
      endOfMessagesRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
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
                />
              </div>
            </div>
          );
        }

        return (
          <div key={m.id}>
            <ChatMessage
              role={m.role as "user" | "assistant"}
              content={m.content}
              isStreaming={isStreamingMessage}
              message={m}
              siblings={siblings}
              onContinue={
                m.role === "assistant" && onContinue
                  ? () => onContinue(m.id)
                  : undefined
              }
              onRetry={
                m.role === "assistant" && onRetry
                  ? () => onRetry(m.id)
                  : undefined
              }
              onEdit={
                m.role === "user" && onEditStart
                  ? () => onEditStart(m.id)
                  : undefined
              }
              onNavigate={
                onNavigate
                  ? (siblingId) => onNavigate(m.id, siblingId)
                  : undefined
              }
              isLoading={actionLoading === m.id}
              isLastAssistantMessage={isLastAssistantMessage}
            />
          </div>
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
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
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
        onSubmit && onSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel && onCancel();
      }
    },
    [onSubmit, onCancel],
  );

  return (
    <div className="rounded-3xl bg-muted text-muted-foreground p-3">
      <div className="w-full min-h-[40px] max-h-[200px]">
        <textarea
          ref={textareaRef}
          className="w-full border-none bg-transparent px-1 text-base shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
      </div>
      <div className="flex items-center gap-2 pt-2 justify-end">
        <button
          type="button"
          className="h-8 px-3 rounded-full border border-border hover:bg-accent text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="h-8 px-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm disabled:opacity-50"
          onClick={onSubmit}
          disabled={!value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
