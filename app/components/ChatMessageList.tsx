import { memo, Profiler, useEffect, useRef, useCallback, type RefObject } from "react";
import { useMotionValue, useSpring, type SpringOptions } from "motion/react";
import ChatMessage from "./ChatMessage";
import {
  isProfilingEnabled,
  mark as profilerMark,
  recordRender,
  recordRowCommit,
} from "@/lib/services/chat-profiler";
import {
  Message,
  MessageSibling,
  Attachment,
  PendingAttachment,
} from "@/lib/types/chat";
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
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onFollowingChange?: (isFollowing: boolean) => void;
  onScrollToBottomRef?: RefObject<(() => void) | null>;
  springConfig?: SpringOptions;
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

const MessageRow = memo(
  function MessageRow({
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

    const handleNavigate = useCallback(
      (siblingId: string) => {
        onNavigate?.(message.id, siblingId);
      },
      [onNavigate, message.id],
    );

    useEffect(() => {
      recordRowCommit(message.id);
    });

    return (
      <ChatMessage
        role={message.role as "user" | "assistant"}
        content={message.content}
        isStreaming={isStreaming}
        message={message}
        siblings={siblings}
        onContinue={
          message.role === "assistant" && onContinue
            ? handleContinue
            : undefined
        }
        onRetry={
          message.role === "assistant" && onRetry ? handleRetry : undefined
        }
        onEdit={message.role === "user" && onEditStart ? handleEdit : undefined}
        onNavigate={onNavigate ? handleNavigate : undefined}
        isLoading={isLoading}
        isLastAssistantMessage={isLastAssistantMessage}
        chatId={chatId}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.attachments?.length ===
        nextProps.message.attachments?.length &&
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
  },
);

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
  scrollContainerRef: externalScrollContainerRef,
  onFollowingChange,
  onScrollToBottomRef,
  springConfig,
}) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const prevMessagesLengthRef = useRef(messages.length);
  const fallbackScrollContainerRef = useRef<HTMLElement | null>(null);
  const isDrivingScrollRef = useRef(false);
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const hasDoneInitialScrollRef = useRef(false);

  const scrollTarget = useMotionValue(0);
  const springScroll = useSpring(scrollTarget, {
    stiffness: 570,
    damping: 38,
    mass: 0.5,
    ...springConfig,
  });

  const getScrollContainer = useCallback((): HTMLElement | null => {
    if (externalScrollContainerRef?.current)
      return externalScrollContainerRef.current;
    return fallbackScrollContainerRef.current;
  }, [externalScrollContainerRef]);

  useEffect(() => {
    return springScroll.on("change", (v) => {
      if (!isDrivingScrollRef.current) return;
      const sc = getScrollContainer();
      if (sc) sc.scrollTop = v;
    });
  }, [springScroll, getScrollContainer]);

  const driveToBottom = useCallback(
    (instant = false) => {
      const sc = getScrollContainer();
      if (!sc) return;
      const target = sc.scrollHeight - sc.clientHeight;
      isDrivingScrollRef.current = true;
      if (instant) {
        springScroll.jump(target);
        sc.scrollTop = target;
      } else {
        scrollTarget.set(target);
      }
    },
    [getScrollContainer, scrollTarget, springScroll],
  );

  const stopDriving = useCallback(() => {
    isDrivingScrollRef.current = false;
    if (!userScrolledAwayRef.current) {
      userScrolledAwayRef.current = true;
      onFollowingChange?.(false);
    }
  }, [onFollowingChange]);

  const scrollToBottom = useCallback(() => {
    userScrolledAwayRef.current = false;
    isAtBottomRef.current = true;
    onFollowingChange?.(true);
    driveToBottom(false);
  }, [driveToBottom, onFollowingChange]);

  useEffect(() => {
    if (onScrollToBottomRef) {
      onScrollToBottomRef.current = scrollToBottom;
    }
  }, [onScrollToBottomRef, scrollToBottom]);

  useEffect(() => {
    const bottomElement = endOfMessagesRef.current;
    if (!bottomElement) return;

    const scrollContainer =
      externalScrollContainerRef?.current ??
      bottomElement.parentElement?.parentElement?.parentElement;
    if (!scrollContainer) return;

    if (!externalScrollContainerRef?.current) {
      fallbackScrollContainerRef.current = scrollContainer;
    }

    const initialBottom =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;
    springScroll.jump(initialBottom);

    const handleScroll = () => {
      if (isDrivingScrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const atBottom = distanceFromBottom < 50;
      isAtBottomRef.current = atBottom;

      if (atBottom && userScrolledAwayRef.current) {
        userScrolledAwayRef.current = false;
        onFollowingChange?.(true);
      }
    };

    const handleWheelInterrupt = (e: WheelEvent) => {
      if (e.deltaY < 0 && isDrivingScrollRef.current) {
        stopDriving();
      }
    };

    const handleTouchInterrupt = () => {
      if (isDrivingScrollRef.current) {
        stopDriving();
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheelInterrupt, {
      passive: true,
    });
    scrollContainer.addEventListener("touchstart", handleTouchInterrupt, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      scrollContainer.removeEventListener("wheel", handleWheelInterrupt);
      scrollContainer.removeEventListener("touchstart", handleTouchInterrupt);
      isDrivingScrollRef.current = false;
    };
  }, [
    externalScrollContainerRef,
    onFollowingChange,
    springScroll,
    stopDriving,
  ]);

  useEffect(() => {
    const chatSwitched = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;

    const userJustSentMessage =
      !chatSwitched &&
      messages.length > prevMessagesLengthRef.current &&
      messages[messages.length - 1]?.role === "user";

    prevMessagesLengthRef.current = messages.length;

    if (chatSwitched) {
      userScrolledAwayRef.current = false;
      isAtBottomRef.current = true;
      onFollowingChange?.(true);
      if (messages.length > 0) {
        hasDoneInitialScrollRef.current = true;
        requestAnimationFrame(() => driveToBottom(true));
      }
      return;
    }

    if (!hasDoneInitialScrollRef.current && messages.length > 0) {
      hasDoneInitialScrollRef.current = true;
      userScrolledAwayRef.current = false;
      isAtBottomRef.current = true;
      onFollowingChange?.(true);
      requestAnimationFrame(() => driveToBottom(false));
      return;
    }

    if (userJustSentMessage) {
      userScrolledAwayRef.current = false;
      isAtBottomRef.current = true;
      onFollowingChange?.(true);
      requestAnimationFrame(() => driveToBottom(false));
      return;
    }

    if (userScrolledAwayRef.current) return;

    requestAnimationFrame(() => driveToBottom(false));
  }, [messages, isLoading, chatId, driveToBottom, onFollowingChange]);

  const filteredMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  const lastAssistantIndex = filteredMessages.reduce(
    (lastIdx, m, idx) => (m.role === "assistant" ? idx : lastIdx),
    -1,
  );

  if (isProfilingEnabled() && filteredMessages.length > 0) {
    profilerMark(`render(${filteredMessages.length})`);
  }

  const tree = (
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

  if (!isProfilingEnabled()) return tree;
  return (
    <Profiler
      id="ChatMessageList"
      onRender={(_id, phase, actualMs) =>
        recordRender(phase === "mount" ? "mount" : "update", actualMs)
      }
    >
      {tree}
    </Profiler>
  );
};

export default memo(ChatMessageList);
