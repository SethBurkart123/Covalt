
import { memo, useEffect, type ReactNode } from "react";
import { preloadRenderersForToolCalls } from "@/components/ToolCallRouter";
import clsx from "clsx";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import MemberRunCall from "./MemberRunCall";
import SubAgentCard from "./SubAgentCard";
import { MessageActions } from "./MessageActions";

import "katex/dist/katex.min.css";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MessageSegmentView } from "./MessageSegmentView";
import { parseMessageSegments } from "@/lib/renderers/parse-message-segments";
import { AttachmentPreview } from "./AttachmentPreview";
import type { ContentBlock, Message, MessageSibling } from "@/lib/types/chat";
import {
  isMemberRunToolBlock,
  isStandaloneToolBlock,
  shouldSkipConsecutiveToolBlock,
} from "@/lib/tool-renderers/layout";
import { toolBlockToMemberRun } from "@/lib/tool-renderers/member-run-surface";

interface ChatMessageProps {
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

type StreamingIndicatorTarget =
  | { kind: "none" }
  | { kind: "text"; blockIndex: number; segmentIndex: number }
  | { kind: "reasoning"; blockIndex: number }
  | { kind: "after-block"; blockIndex: number };

const NO_STREAMING_INDICATOR: StreamingIndicatorTarget = { kind: "none" };

function isInitialStreamingPlaceholder(content: ContentBlock[]): boolean {
  if (content.length === 0) return true;
  return content.length === 1 && content[0].type === "text" && content[0].content === "";
}

function hasActiveToolCall(blocks: ContentBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === "tool_call") return !block.isCompleted;
    if (block.type === "member_run") return hasActiveToolCall(block.content);
    return false;
  });
}

function lastMarkdownSegmentIndex(text: string): number {
  const segments = parseMessageSegments(text);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind === "markdown" && segment.text?.trim()) return i;
  }
  return -1;
}

function getStreamingIndicatorTarget(
  content: ContentBlock[],
  isStreaming?: boolean,
): StreamingIndicatorTarget {
  if (!isStreaming || isInitialStreamingPlaceholder(content)) {
    return NO_STREAMING_INDICATOR;
  }
  if (hasActiveToolCall(content)) return NO_STREAMING_INDICATOR;

  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];

    if (block.type === "text") {
      if (!block.content.trim()) continue;
      const segmentIndex = lastMarkdownSegmentIndex(block.content);
      return segmentIndex === -1
        ? { kind: "after-block", blockIndex: i }
        : { kind: "text", blockIndex: i, segmentIndex };
    }

    if (block.type === "reasoning") {
      if (!block.isCompleted) return { kind: "reasoning", blockIndex: i };
      return { kind: "after-block", blockIndex: i };
    }

    if (block.type === "tool_call") {
      if (block.isDelegation) continue;
      return { kind: "after-block", blockIndex: i };
    }

    if (block.type === "error" || block.type === "system_event" || block.type === "flow_step") {
      return NO_STREAMING_INDICATOR;
    }
  }

  return NO_STREAMING_INDICATOR;
}

function TypewriterIndicator() {
  return <span className="inline-typewriter-indicator" aria-hidden="true" />;
}

function StreamingBlockIndicator() {
  return (
    <div className="streaming-block-indicator not-prose" aria-hidden="true">
      <TypewriterIndicator />
    </div>
  );
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
  const assistantBlocks = Array.isArray(content) ? content : null;
  const indicatorTarget = assistantBlocks
    ? getStreamingIndicatorTarget(assistantBlocks, isStreaming)
    : NO_STREAMING_INDICATOR;

  useEffect(() => {
    if (!Array.isArray(content)) {
      return;
    }

    const renderers: Array<{ renderer?: string; toolName?: string }> = [];
    const queueRenderers = (blocks: ContentBlock[]) => {
      blocks.forEach((block) => {
        if (block.type === "tool_call") {
          renderers.push({
            renderer: block.renderPlan?.renderer,
            toolName: block.toolName,
          });
        } else if (block.type === "member_run") {
          queueRenderers(block.content);
        }
      });
    };

    queueRenderers(content);
    preloadRenderersForToolCalls(renderers);
  }, [content]);

  return (
    <div
      className={clsx(
        "flex w-full group/message",
        role === "user"
          ? "justify-end -mb-4 mt-4 max-w-[90%] ml-auto"
          : "justify-start",
      )}
    >
      <div className="relative mb-2 w-full">
        {role === "user" ? (
          <div className="flex flex-col w-full place-items-end">
            {message?.attachments && message.attachments.length > 0 && (
              <div className="mb-2">
                <AttachmentPreview
                  attachments={message.attachments}
                  readonly
                  chatId={chatId}
                />
              </div>
            )}
            <div
              data-testid="chat-message-user"
              className="rounded-3xl text-base leading-relaxed bg-muted text-muted-foreground px-5 py-2.5 w-fit overflow-x-scroll max-w-full"
            >
              {typeof content === "string" ? (
                <MarkdownRenderer content={content} trimLast />
              ) : (
                <p />
              )}
            </div>
          </div>
        ) : (
          <div
            className={clsx(
              "rounded-3xl text-base leading-relaxed max-w-full min-w-0 text-card-foreground",
              "prose prose-zinc dark:prose-invert prose-p:my-2 prose-li:my-0.5 px-2 py-2.5 w-full",
            )}
          >
            <div
              data-testid="chat-message-assistant"
              className="relative assistant-message w-full prose !max-w-none dark:prose-invert prose-zinc"
            >
              {assistantBlocks && (
                <>
                  {isInitialStreamingPlaceholder(assistantBlocks) &&
                  isStreaming ? (
                    <div className="inline-block">
                      <TypewriterIndicator />
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const blocks = assistantBlocks;
                        const rendered: ReactNode[] = [];

                        for (let i = 0; i < blocks.length; i++) {
                          const block = blocks[i];

                          if (block.type === "text") {
                            if (block.content && block.content.trim() !== "") {
                              const segments = parseMessageSegments(block.content);
                              segments.forEach((segment, segIdx) => {
                                const isCursorSegment =
                                  indicatorTarget.kind === "text" &&
                                  indicatorTarget.blockIndex === i &&
                                  indicatorTarget.segmentIndex === segIdx;

                                rendered.push(
                                  <MessageSegmentView
                                    key={`text-${i}-${segIdx}`}
                                    segment={segment}
                                    chatId={chatId}
                                    showCursor={isCursorSegment}
                                  />,
                                );
                              });
                            }
                            if (
                              indicatorTarget.kind === "after-block" &&
                              indicatorTarget.blockIndex === i
                            ) {
                              rendered.push(
                                <StreamingBlockIndicator key={`indicator-${i}`} />,
                              );
                            }
                            continue;
                          }

                          if (block.type === "error") {
                            rendered.push(
                              <div
                                key={`error-${i}`}
                                className="my-3 p-4 rounded-lg selection:bg-destructive/20 relative text-destructive overflow-visible before:content-around before:absolute before:pointer-events-none before:top-0 before:left-0 before:w-full before:h-full before:bg-destructive/20 before:rounded-full before:blur-2xl"
                              >
                                <div className="flex items-start gap-3">
                                  <svg
                                    className="w-5 h-5 mt-0.5 shrink-0"
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
                              </div>,
                            );
                            continue;
                          }

                          if (
                            block.type === "member_run" &&
                            block.groupByNode
                          ) {
                            rendered.push(
                              <MemberRunCall
                                key={block.runId || `member-${i}`}
                                memberName={block.memberName}
                                nodeId={block.nodeId}
                                content={block.content}
                                active={!block.isCompleted && !!isStreaming}
                                isCompleted={block.isCompleted}
                                hasError={block.hasError}
                                cancelled={block.cancelled}
                                state={block.state}
                                alwaysOpen
                                compact
                              />,
                            );
                            continue;
                          }

                          if (block.type === "member_run") {
                            rendered.push(
                              <SubAgentCard
                                key={block.runId || `member-${i}`}
                                runId={block.runId}
                                memberName={block.memberName}
                                content={block.content}
                                task={block.task}
                                active={!block.isCompleted && !!isStreaming}
                                isCompleted={block.isCompleted}
                                hasError={block.hasError}
                                cancelled={block.cancelled}
                                state={block.state}
                                chatId={chatId}
                              />,
                            );
                            continue;
                          }

                          if (
                            block.type === "tool_call" ||
                            block.type === "reasoning"
                          ) {
                            if (shouldSkipConsecutiveToolBlock(blocks, i)) {
                              continue;
                            }

                            if (block.type === "tool_call" && isMemberRunToolBlock(block)) {
                              const member = toolBlockToMemberRun(block);
                              rendered.push(
                                <SubAgentCard
                                  key={member.runId || `member-tool-${i}`}
                                  runId={member.runId}
                                  memberName={member.memberName}
                                  content={member.content}
                                  task={member.task}
                                  active={!member.isCompleted && !!isStreaming}
                                  isCompleted={member.isCompleted}
                                  hasError={member.hasError}
                                  cancelled={member.cancelled}
                                  state={member.state}
                                  chatId={chatId}
                                />,
                              );
                              continue;
                            }

                            if (block.type === "tool_call" && isStandaloneToolBlock(block)) {
                              rendered.push(
                                <div key={block.id || `tool-${i}`} className="my-3 not-prose">
                                  <ToolCall {...block} chatId={chatId} />
                                </div>,
                              );
                              continue;
                            }

                            const start = i;
                            const group: Array<{
                              block: ContentBlock;
                              index: number;
                            }> = [];
                            let j = i;

                            while (j < blocks.length) {
                              const b = blocks[j];
                              if (
                                b.type === "member_run"
                                || isStandaloneToolBlock(b)
                              ) {
                                break;
                              }
                              if (
                                b.type === "tool_call" ||
                                b.type === "reasoning"
                              ) {
                                group.push({ block: b, index: j });
                                j++;
                                continue;
                              }
                              if (
                                b.type === "text" &&
                                b.content.trim() === ""
                              ) {
                                j++;
                                continue;
                              }
                              break;
                            }

                            i = j - 1;

                            const visibleGroup = group.filter(
                              ({ block: b }) =>
                                !(b.type === "tool_call" && b.isDelegation),
                            );

                            const groupItems = visibleGroup.map(({ block: b, index: blockIndex }, idx) => {
                              if (b.type === "tool_call") {
                                return (
                                  <ToolCall
                                    key={b.id}
                                    {...b}
                                    isGrouped={visibleGroup.length > 1}
                                    isFirst={idx === 0}
                                    isLast={idx === visibleGroup.length - 1}
                                    chatId={chatId}
                                  />
                                );
                              } else if (b.type === "reasoning") {
                                return (
                                  <ThinkingCall
                                    key={`think-${start}-${idx}`}
                                    content={b.content}
                                    isGrouped={visibleGroup.length > 1}
                                    isFirst={idx === 0}
                                    isLast={idx === visibleGroup.length - 1}
                                    active={!b.isCompleted && !!isStreaming}
                                    isCompleted={b.isCompleted}
                                    showIndicator={
                                      indicatorTarget.kind === "reasoning" &&
                                      indicatorTarget.blockIndex === blockIndex
                                    }
                                  />
                                );
                              }
                              return null;
                            });

                            if (visibleGroup.length === 1) {
                              rendered.push(groupItems[0]);
                            } else if (visibleGroup.length > 1) {
                              rendered.push(
                                <div
                                  key={`group-${start}`}
                                  className="my-3 not-prose"
                                >
                                  <div className="border border-border rounded-lg overflow-hidden bg-card">
                                    {groupItems}
                                  </div>
                                </div>,
                              );
                            }

                            if (
                              indicatorTarget.kind === "after-block" &&
                              group.some(({ index }) => index === indicatorTarget.blockIndex)
                            ) {
                              rendered.push(
                                <StreamingBlockIndicator key={`indicator-${indicatorTarget.blockIndex}`} />,
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
          <div
            className={clsx(
              "flex items-center gap-1 transition-opacity duration-200 px-1 pointer-events-auto",
              role === "user" ? "justify-end" : "justify-start",
              role === "user"
                ? "opacity-0 group-hover/message:opacity-100 hover:opacity-100 focus-within:opacity-100"
                : isLastAssistantMessage
                  ? "opacity-100"
                  : "opacity-0 group-hover/message:opacity-100 hover:opacity-100 focus-within:opacity-100",
            )}
          >
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

function arePropsEqual(
  prevProps: ChatMessageProps,
  nextProps: ChatMessageProps,
) {
  return (
    !nextProps.isStreaming &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.role === nextProps.role &&
    prevProps.content === nextProps.content &&
    prevProps.message?.id === nextProps.message?.id &&
    prevProps.message?.attachments?.length ===
      nextProps.message?.attachments?.length &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isLastAssistantMessage === nextProps.isLastAssistantMessage &&
    prevProps.siblings?.length === nextProps.siblings?.length
  );
}

export default memo(ChatMessage, arePropsEqual);
