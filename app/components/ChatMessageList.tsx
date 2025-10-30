import React, { useEffect, useRef } from "react";
import ChatMessage from "./Message";
import { Message } from "@/lib/types/chat";

interface ChatMessageListProps {
  messages: Message[];
  isLoading: boolean;
  AssistantMessageActions: React.FC<{ messageIndex: number }>;
}

const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, isLoading, AssistantMessageActions }) => {
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

  return (
    <>
      {messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m, index) => (
          <div className="group flex flex-col relative" key={m.id}>
            <ChatMessage
              role={m.role as "user" | "assistant"}
              content={m.content}
              isStreaming={isLoading && index === messages.length - 1 && m.role === "assistant"}
            />
            {!isLoading && (
              <AssistantMessageActions messageIndex={index} />
            )}
          </div>
        ))}
      <div ref={endOfMessagesRef} className="h-8 -mt-" />
    </>
  );
};

export default React.memo(ChatMessageList); 