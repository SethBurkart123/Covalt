import React, { useEffect, useRef } from "react";
import ChatMessage from "./Message";
import { Message, MessageSibling } from "@/lib/types/chat";

interface ChatMessageListProps {
  messages: Message[];
  isLoading: boolean;
  messageSiblings: Record<string, MessageSibling[]>;
  onContinue?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
  onNavigate?: (messageId: string, siblingId: string) => void;
  actionLoading?: string | null;
}

const ChatMessageList: React.FC<ChatMessageListProps> = ({ 
  messages, 
  isLoading, 
  messageSiblings,
  onContinue,
  onRetry,
  onEdit,
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

    const scrollContainer = bottomElement.parentElement?.parentElement?.parentElement;
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
        rootMargin: '100px',
      }
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
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const userJustSentMessage = 
      messages.length > prevMessagesLengthRef.current &&
      messages[messages.length - 1]?.role === 'user';
    
    prevMessagesLengthRef.current = messages.length;

    if (userJustSentMessage && endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      isAtBottomRef.current = true;
    } else if (isAtBottomRef.current && endOfMessagesRef.current) {
      // console.log('scrolling to bottom');
      endOfMessagesRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading]);

  const filteredMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  
  // Find the last assistant message index
  const lastAssistantIndex = filteredMessages.reduce((lastIdx, m, idx) => {
    return m.role === "assistant" ? idx : lastIdx;
  }, -1);

  return (
    <>
      {filteredMessages.map((m, index) => {
          const siblings = messageSiblings[m.id] || [];
          const isStreamingMessage = isLoading && index === filteredMessages.length - 1 && m.role === "assistant";
          const isLastAssistantMessage = !isLoading && index === lastAssistantIndex && m.role === "assistant";
          
          return (
            <div key={m.id}>
              <ChatMessage
                role={m.role as "user" | "assistant"}
                content={m.content}
                isStreaming={isStreamingMessage}
                message={m}
                siblings={siblings}
                onContinue={!m.isComplete && m.role === 'assistant' && onContinue ? () => onContinue(m.id) : undefined}
                onRetry={m.role === 'assistant' && onRetry ? () => onRetry(m.id) : undefined}
                onEdit={m.role === 'user' && onEdit ? () => onEdit(m.id) : undefined}
                onNavigate={onNavigate ? (siblingId) => onNavigate(m.id, siblingId) : undefined}
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