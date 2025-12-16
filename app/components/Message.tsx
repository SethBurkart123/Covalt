"use client";

import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import { MessageActions } from "./MessageActions";

import "katex/dist/katex.min.css";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { ContentBlock, Message, MessageSibling } from "@/lib/types/chat";

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string | ContentBlock[];
  isStreaming?: boolean;
  message?: Message;
  siblings?: MessageSibling[];
  onContinue?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onNavigate?: (siblingId: string) => void;
  isLoading?: boolean;
  isLastAssistantMessage?: boolean;
}

function ChatMessage({
  role,
  content,
  isStreaming,
  message,
  siblings,
  onContinue,
  onRetry,
  onEdit,
  onNavigate,
  isLoading,
  isLastAssistantMessage,
}: ChatMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Effect to place the cursor indicator at the end of streaming text
  useEffect(() => {
    if (!contentRef.current) return;

    const existingIndicators = contentRef.current.querySelectorAll(
      ".inline-typewriter-indicator"
    );
    existingIndicators.forEach((el) => el.remove());

    // Show cursor indicator if streaming and has content
    const hasContent =
      typeof content === "string"
        ? content !== ""
        : Array.isArray(content) && content.length > 0;

    if (isStreaming && hasContent) {
      // Find the last text node
      const walker = document.createTreeWalker(
        contentRef.current,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (node.nodeValue?.trim() === "") return NodeFilter.FILTER_SKIP;
            const parentEl = (
              node as unknown as ChildNode & { parentElement: Element | null }
            ).parentElement;
            if (parentEl && parentEl.closest("[data-toolcall]")) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let lastTextNode: Text | null = null;
      while (walker.nextNode()) {
        lastTextNode = walker.currentNode as Text;
      }

      if (lastTextNode && lastTextNode.parentNode) {
        const indicatorSpan = document.createElement("span");
        indicatorSpan.classList.add("inline-typewriter-indicator");

        if (lastTextNode.nextSibling) {
          lastTextNode.parentNode.insertBefore(
            indicatorSpan,
            lastTextNode.nextSibling
          );
        } else {
          lastTextNode.parentNode.appendChild(indicatorSpan);
        }
      }
    }

    return () => {
      if (contentRef.current) {
        const indicators = contentRef.current.querySelectorAll(
          ".inline-typewriter-indicator"
        );
        indicators.forEach((el) => el.remove());
      }
    };
  }, [isStreaming, content]);

  // Always show actions if we have a message (Copy is always available)
  const showActions = !!message;
  
  return (
    <div
      className={clsx(
        "flex w-full group/message",
        role === "user" ? "justify-end" : "justify-start"
      )}
    >
      <div className={`relative mb-2 ${role === "assistant" && "w-full"}`}>
        {/* Message bubble - different styling based on role */}
        {role === "user" ? (
          <div className="rounded-3xl text-base leading-relaxed bg-muted text-muted-foreground px-5 py-2.5 w-fit ml-auto">
            <p>{typeof content === "string" ? content : ""}</p>
          </div>
        ) : (
          <div
            className={clsx(
              "rounded-3xl text-base leading-relaxed max-w-full min-w-0 text-card-foreground",
              "prose prose-zinc dark:prose-invert prose-p:my-2 prose-li:my-0.5 px-2 py-2.5 w-full"
            )}
          >
          <div
            ref={contentRef}
            className="relative assistant-message w-full prose !max-w-none dark:prose-invert prose-zinc"
          >
            {Array.isArray(content) && (
              <>
                {/* Show indicator when run started but no content yet */}
                {content.length === 1 &&
                content[0].type === "text" &&
                content[0].content === "" &&
                isStreaming ? (
                  <div className="inline-block">
                    <div className="size-[0.65rem] bg-primary rounded-full animate-pulse"></div>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const blocks = content as ContentBlock[];
                      const rendered: React.ReactNode[] = [];

                      for (let i = 0; i < blocks.length; i++) {
                        const block = blocks[i];

                        // Check if this is a text block
                        if (block.type === "text") {
                          const text = block.content;
                          if (text && text.trim() !== "") {
                            rendered.push(
                              <MarkdownRenderer
                                key={`text-${i}`}
                                content={text}
                              />
                            );
                          }
                          continue;
                        }

                        if (block.type === "error") {
                          rendered.push(
                            <div
                              key={`error-${i}`}
                              className="my-3 p-4 rounded-lg selection:bg-destructive/20 relative text-destructive overflow-visible before:content-around before:absolute before:top-0 before:left-0 before:w-full before:h-full before:bg-destructive/20 before:rounded-full before:blur-2xl"
                            >
                              <div className="flex items-start gap-3">
                                <svg
                                  className="w-5 h-5 mt-0.5 flex-shrink-0"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                <div className="flex-1">
                                  <div className="text-sm whitespace-pre-wrap">
                                    {block.content}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                          continue;
                        }

                        // For tool_call or reasoning blocks, check if we can group with consecutive ones
                        if (
                          block.type === "tool_call" ||
                          block.type === "reasoning"
                        ) {
                          const start = i;
                          const group: ContentBlock[] = [];
                          let j = i;

                          // Gather consecutive tool_call/reasoning blocks (allowing whitespace text in between)
                          while (j < blocks.length) {
                            const b = blocks[j];
                            if (
                              b.type === "tool_call" ||
                              b.type === "reasoning"
                            ) {
                              group.push(b);
                              j++;
                              continue;
                            }
                            if (b.type === "text" && b.content.trim() === "") {
                              j++;
                              continue;
                            }
                            break;
                          }

                          i = j - 1; // for-loop will increment

                          const groupItems = group.map((b, idx) => {
                            if (b.type === "tool_call") {
                              return (
                                <ToolCall
                                  key={b.id}
                                  toolName={b.toolName}
                                  toolArgs={b.toolArgs}
                                  toolResult={b.toolResult}
                                  isCompleted={b.isCompleted}
                                  renderer={b.renderer}
                                  requiresApproval={b.requiresApproval}
                                  runId={b.runId}
                                  toolCallId={b.toolCallId}
                                  approvalStatus={b.approvalStatus}
                                  editableArgs={b.editableArgs}
                                  isGrouped={group.length > 1}
                                  isFirst={idx === 0}
                                  isLast={idx === group.length - 1}
                                />
                              );
                            } else if (b.type === "reasoning") {
                              // reasoning block
                              return (
                                <ThinkingCall
                                  key={`think-${start}-${idx}`}
                                  content={b.content}
                                  isGrouped={group.length > 1}
                                  isFirst={idx === 0}
                                  isLast={idx === group.length - 1}
                                  active={!b.isCompleted && !!isStreaming}
                                />
                              );
                            }
                            return null;
                          });

                          // Render single item standalone, or multiple items in a grouped container
                          if (group.length === 1) {
                            rendered.push(groupItems[0]);
                          } else if (group.length > 1) {
                            rendered.push(
                              <div
                                key={`group-${start}`}
                                className="my-3 not-prose"
                              >
                                <div className="border border-border rounded-lg overflow-hidden bg-card">
                                  {groupItems}
                                </div>
                              </div>
                            );
                          }
                        }
                      }

                      return rendered;
                    })()}
                  </>
                )}
              </>
            )}
          </div>
          </div>
        )}
        
        {showActions && (!isStreaming) && (
          <div className={clsx(
            "flex items-center gap-1 transition-opacity duration-200 px-1 pointer-events-auto",
            role === "user" ? "justify-end" : "justify-start",
            role === "user"
              ? "opacity-0 group-hover/message:opacity-100 hover:opacity-100 focus-within:opacity-100"
              : isLastAssistantMessage
                ? "opacity-100"
                : "opacity-0 group-hover/message:opacity-100 hover:opacity-100 focus-within:opacity-100"
          )}>
            <MessageActions
              message={message!}
              siblings={siblings || []}
              onContinue={onContinue}
              onRetry={onRetry}
              onEdit={onEdit}
              onNavigate={onNavigate}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Custom comparison function to prevent unnecessary re-renders
function arePropsEqual(prevProps: ChatMessageProps, nextProps: ChatMessageProps) {
  // If streaming status changed, re-render
  if (prevProps.isStreaming !== nextProps.isStreaming) {
    return false;
  }
  
  // If this message is currently streaming, always re-render to show updates
  if (nextProps.isStreaming) {
    return false;
  }
  
  // If not streaming, compare other props
  return (
    prevProps.role === nextProps.role &&
    prevProps.content === nextProps.content &&
    prevProps.message?.id === nextProps.message?.id &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isLastAssistantMessage === nextProps.isLastAssistantMessage &&
    prevProps.siblings?.length === nextProps.siblings?.length
  );
}

export default React.memo(ChatMessage, arePropsEqual);
