"use client";

import { memo, useEffect, useRef } from "react";
import clsx from "clsx";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import MemberRunCall from "./MemberRunCall";
import { MessageActions } from "./MessageActions";

import "katex/dist/katex.min.css";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AttachmentPreview } from "./AttachmentPreview";
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
  chatId?: string;
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
  chatId,
}: ChatMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    content.querySelectorAll(".inline-typewriter-indicator").forEach((el) => el.remove());

    if (isStreaming) {
      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (node.nodeValue?.trim() === "") return NodeFilter.FILTER_SKIP;
            const parentEl = node.parentElement;
            if (parentEl?.closest("[data-toolcall]")) {
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
      content.querySelectorAll(".inline-typewriter-indicator").forEach((el) => el.remove());
    };
  }, [isStreaming, content]);

  return (
    <div
      className={clsx(
        "flex w-full group/message",
        role === "user" ? "justify-end -mb-4 mt-4 max-w-[90%] ml-auto" : "justify-start"
      )}
    >
      <div className="relative mb-2 w-full">
        {role === "user" ? (
          <div className="flex flex-col w-full place-items-end">
            {message?.attachments && message.attachments.length > 0 && (
              <div className="mb-2">
                <AttachmentPreview attachments={message.attachments} readonly chatId={chatId} />
              </div>
            )}
            <div className="rounded-3xl text-base leading-relaxed bg-muted text-muted-foreground px-5 py-2.5 w-fit overflow-x-scroll max-w-full">
              <p>{typeof content === "string" ? content : ""}</p>
            </div>
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
                                  <div className="text-sm whitespace-pre-wrap selection:bg-green-500">
                                    {block.content}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                          continue;
                        }

                        if (
                          block.type === "tool_call" ||
                          block.type === "reasoning" ||
                          block.type === "member_run"
                        ) {
                          const start = i;
                          const group: ContentBlock[] = [];
                          let j = i;

                          while (j < blocks.length) {
                            const b = blocks[j];
                            if (
                              b.type === "tool_call" ||
                              b.type === "reasoning" ||
                              b.type === "member_run"
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

                          i = j - 1;

                          const groupItems = group.flatMap((b, idx) => {
                            if (b.type === "tool_call" && b.isDelegation) {
                              return [];
                            }
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
                                  renderPlan={b.renderPlan}
                                  chatId={chatId}
                                />
                              );
                            } else if (b.type === "reasoning") {
                              return (
                                <ThinkingCall
                                  key={`think-${start}-${idx}`}
                                  content={b.content}
                                  isGrouped={group.length > 1}
                                  isFirst={idx === 0}
                                  isLast={idx === group.length - 1}
                                  active={!b.isCompleted && !!isStreaming}
                                  isCompleted={b.isCompleted}
                                />
                              );
                            } else if (b.type === "member_run") {
                              return (
                                <MemberRunCall
                                  key={b.runId || `member-${start}-${idx}`}
                                  memberName={b.memberName}
                                  content={b.content}
                                  isGrouped={group.length > 1}
                                  isFirst={idx === 0}
                                  isLast={idx === group.length - 1}
                                  active={!b.isCompleted && !!isStreaming}
                                  isCompleted={b.isCompleted}
                                />
                              );
                            }
                            return null;
                          });

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
        
        {message && !isStreaming && (
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
              message={message}
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

function arePropsEqual(prevProps: ChatMessageProps, nextProps: ChatMessageProps) {
  return (
    !nextProps.isStreaming &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.role === nextProps.role &&
    prevProps.content === nextProps.content &&
    prevProps.message?.id === nextProps.message?.id &&
    prevProps.message?.attachments?.length === nextProps.message?.attachments?.length &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isLastAssistantMessage === nextProps.isLastAssistantMessage &&
    prevProps.siblings?.length === nextProps.siblings?.length
  );
}

export default memo(ChatMessage, arePropsEqual);
