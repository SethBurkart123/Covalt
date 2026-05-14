
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from "motion/react";
import { cn } from "@/lib/utils";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { parseToolDisplayParts } from "@/lib/tooling";
import { ApprovalRouter } from "./approvals/ApprovalRouter";
import { buildLegacyApprovalRequest } from "@/lib/services/approval-request-builder";
import { useResolveToolDecision } from "@/lib/services/use-resolve-tool-decision";
import {
  isMemberRunToolBlock,
  isStandaloneToolBlock,
  shouldSkipConsecutiveToolBlock,
} from "@/lib/tool-renderers/layout";
import { toolBlockToMemberRun } from "@/lib/tool-renderers/member-run-surface";
import { MarkdownRenderer } from "./MarkdownRenderer";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import type { ContentBlock } from "@/lib/types/chat";

interface SubAgentCardProps {
  runId: string;
  memberName: string;
  content: ContentBlock[];
  task?: string;
  active?: boolean;
  isCompleted?: boolean;
  hasError?: boolean;
  cancelled?: boolean;
  state?: string;
  chatId?: string;
}

function TaskPrompt({ task }: { task: string }) {
  return (
    <div className="flex justify-end px-4 pt-4">
      <div className="rounded-3xl text-sm leading-relaxed bg-muted text-muted-foreground px-5 py-2.5 max-w-[85%]">
        <MarkdownRenderer content={task} trimLast />
      </div>
    </div>
  );
}

function TextBlock({
  content,
  lookaheadContent,
  visibleChars,
}: {
  content: string;
  lookaheadContent?: string;
  visibleChars?: number;
}) {
  if (!content.trim()) return null;
  return (
    <div className="px-4">
      <MarkdownRenderer content={lookaheadContent ?? content} visibleChars={visibleChars} />
    </div>
  );
}

function ErrorBlock({ content }: { content: string }) {
  return <div className="text-sm text-destructive px-5 py-1">{content}</div>;
}

function isBlockGroupable(block: ContentBlock): boolean {
  return (
    (block.type === "tool_call" && !isStandaloneToolBlock(block))
    || block.type === "reasoning"
  );
}

function isEmptyTextBlock(block: ContentBlock): boolean {
  return block.type === "text" && !block.content.trim();
}

function BlockItem({
  block,
  index,
  groupSize,
  chatId,
  active,
}: {
  block: ContentBlock;
  index: number;
  groupSize: number;
  chatId?: string;
  active?: boolean;
}) {
  const isGrouped = groupSize > 1;
  const isFirst = index === 0;
  const isLast = index === groupSize - 1;

  if (block.type === "tool_call") {
    return (
      <ToolCall
        key={block.id || `tool-${index}`}
        {...block}
        isGrouped={isGrouped}
        isFirst={isFirst}
        isLast={isLast}
        chatId={chatId}
      />
    );
  }

  if (block.type === "reasoning") {
    return (
      <ThinkingCall
        key={`think-${index}`}
        content={block.content}
        lookaheadContent={block.lookaheadContent}
        visibleChars={block.visibleChars}
        isGrouped={isGrouped}
        isFirst={isFirst}
        isLast={isLast}
        active={!block.isCompleted && !!active}
        isCompleted={block.isCompleted}
      />
    );
  }

  return null;
}

function BlockGroup({
  blocks,
  chatId,
  active,
}: {
  blocks: ContentBlock[];
  chatId?: string;
  active?: boolean;
}) {
  const items = blocks.map((block, idx) => (
    <BlockItem
      key={idx}
      block={block}
      index={idx}
      groupSize={blocks.length}
      chatId={chatId}
      active={active}
    />
  ));

  if (blocks.length === 1) {
    return <div className="px-4">{items[0]}</div>;
  }

  return (
    <div className="px-4 my-3 not-prose">
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        {items}
      </div>
    </div>
  );
}

function SubAgentContent({
  content,
  task,
  active,
  chatId,
}: {
  content: ContentBlock[];
  task?: string;
  active?: boolean;
  chatId?: string;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endOfContentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const prevContentLengthRef = useRef(content.length);
  const isDrivingScrollRef = useRef(false);

  const scrollTarget = useMotionValue(0);
  const springScroll = useSpring(scrollTarget, {
    stiffness: 570,
    damping: 38,
    mass: 0.5,
  });

  useEffect(() => {
    return springScroll.on("change", (v) => {
      if (!isDrivingScrollRef.current) return;
      const sc = scrollContainerRef.current;
      if (sc) sc.scrollTop = v;
    });
  }, [springScroll]);

  const driveToBottom = useCallback(
    (instant = false) => {
      const sc = scrollContainerRef.current;
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
    [scrollTarget, springScroll],
  );

  const stopDriving = useCallback(() => {
    isDrivingScrollRef.current = false;
    userScrolledAwayRef.current = true;
  }, []);

  useEffect(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return;

    const initialBottom = sc.scrollHeight - sc.clientHeight;
    springScroll.jump(initialBottom);

    const handleScroll = () => {
      if (isDrivingScrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = sc;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const atBottom = distanceFromBottom < 50;
      isAtBottomRef.current = atBottom;

      if (atBottom && userScrolledAwayRef.current) {
        userScrolledAwayRef.current = false;
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

    sc.addEventListener("scroll", handleScroll, { passive: true });
    sc.addEventListener("wheel", handleWheelInterrupt, { passive: true });
    sc.addEventListener("touchstart", handleTouchInterrupt, { passive: true });

    return () => {
      sc.removeEventListener("scroll", handleScroll);
      sc.removeEventListener("wheel", handleWheelInterrupt);
      sc.removeEventListener("touchstart", handleTouchInterrupt);
      isDrivingScrollRef.current = false;
    };
  }, [springScroll, stopDriving]);

  useEffect(() => {
    const contentAdded = content.length > prevContentLengthRef.current;
    prevContentLengthRef.current = content.length;

    if (contentAdded) {
      userScrolledAwayRef.current = false;
      isAtBottomRef.current = true;
    }

    if (userScrolledAwayRef.current) return;

    requestAnimationFrame(() => driveToBottom(false));
  }, [content, driveToBottom]);

  const elements: React.ReactNode[] = [];

  if (task) {
    elements.push(<TaskPrompt key="task" task={task} />);
  }

  let i = 0;
  while (i < content.length) {
    const block = content[i];

    if (block.type === "text") {
      elements.push(
        <TextBlock
          key={`text-${i}`}
          content={block.content}
          lookaheadContent={block.lookaheadContent}
          visibleChars={block.visibleChars}
        />,
      );
      i++;
      continue;
    }

    if (block.type === "error") {
      elements.push(<ErrorBlock key={`error-${i}`} content={block.content} />);
      i++;
      continue;
    }

    if (shouldSkipConsecutiveToolBlock(content, i)) {
      i++;
      continue;
    }

    if (block.type === "tool_call" && isMemberRunToolBlock(block)) {
      const member = toolBlockToMemberRun(block);
      elements.push(
        <div key={`member-tool-${i}`} className="px-4">
          <SubAgentCard
            runId={member.runId}
            memberName={member.memberName}
            content={member.content}
            task={member.task}
            active={!member.isCompleted && active}
            isCompleted={member.isCompleted}
            hasError={member.hasError}
            cancelled={member.cancelled}
            state={member.state}
            chatId={chatId}
          />
        </div>,
      );
      i++;
      continue;
    }

    if (isBlockGroupable(block)) {
      const group: ContentBlock[] = [];
      let j = i;

      while (
        j < content.length &&
        (isBlockGroupable(content[j]) || isEmptyTextBlock(content[j]))
      ) {
        if (isBlockGroupable(content[j])) {
          group.push(content[j]);
        }
        j++;
      }

      elements.push(
        <BlockGroup
          key={`group-${i}`}
          blocks={group}
          chatId={chatId}
          active={active}
        />,
      );
      i = j;
      continue;
    }

    if (block.type === "tool_call" && isStandaloneToolBlock(block)) {
      elements.push(
        <div key={`tool-${i}`} className="px-4 my-3 not-prose">
          <ToolCall {...block} chatId={chatId} />
        </div>,
      );
      i++;
      continue;
    }

    i++;
  }

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-auto">
      <div className="max-w-[50rem] w-full mx-auto space-y-1 pb-4">
        {elements}
        <div ref={endOfContentRef} className="h-4" />
      </div>
    </div>
  );
}

type PendingApproval = Extract<ContentBlock, { type: "tool_call" }> & {
  requiresApproval: true;
  approvalStatus: "pending";
  runId: string;
  toolCallId: string;
};

function findPendingApprovals(content: ContentBlock[]): PendingApproval[] {
  return content.filter(
    (block): block is PendingApproval =>
      block.type === "tool_call" &&
      block.requiresApproval === true &&
      block.approvalStatus === "pending" &&
      !!block.runId &&
      !!block.toolCallId,
  );
}

function formatToolName(toolName: string): string {
  const { label, namespace } = parseToolDisplayParts(toolName);
  return namespace ? `${namespace}, ${label}` : label;
}

function getPreviewText(
  content: ContentBlock[],
  isCompleted: boolean,
  hasError: boolean,
  cancelled: boolean = false,
  state?: string,
): string {
  if (hasError) return "Failed";
  if (cancelled) return "Cancelled";
  if (isCompleted) return "Completed";
  if (state) return formatState(state);

  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block.type === "tool_call") {
      return block.isCompleted
        ? `Ran ${formatToolName(block.toolName)}`
        : `Running ${formatToolName(block.toolName)}`;
    }
    if (block.type === "reasoning" && !block.isCompleted) {
      return "Thinking...";
    }
  }

  const hasContent = content.some((b) => b.type !== "text" || b.content.trim());
  return hasContent ? "Working..." : "Starting...";
}

function formatState(state: string): string {
  const cleaned = state.replace(/[_-]+/g, " ").trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "Working...";
}

function PendingApprovalEntry({
  tool,
  onResolved,
}: {
  tool: PendingApproval;
  onResolved?: () => void;
}) {
  const request = useMemo(
    () => buildLegacyApprovalRequest(tool, tool.runId),
    [tool],
  );
  const toolCallId = tool.toolCallId ?? tool.id;
  const resolve = useResolveToolDecision(tool.runId, toolCallId);
  const handleResolve = useCallback(
    async (outcome: Parameters<typeof resolve>[0]) => {
      const result = await resolve(outcome);
      if (result.matched) onResolved?.();
    },
    [resolve, onResolved],
  );

  return (
    <ApprovalRouter request={request} isPending={true} onResolve={handleResolve} />
  );
}

function InlineApproval({
  tools,
  onResolved,
}: {
  tools: PendingApproval[];
  onResolved?: () => void;
}) {
  return (
    <div className="px-4 pb-4 space-y-3">
      {tools.map((tool) => (
        <PendingApprovalEntry
          key={tool.toolCallId}
          tool={tool}
          onResolved={onResolved}
        />
      ))}
    </div>
  );
}

export default function SubAgentCard({
  runId,
  memberName,
  content,
  task,
  active = false,
  isCompleted = false,
  hasError = false,
  cancelled = false,
  state,
  chatId,
}: SubAgentCardProps) {
  const { open, close, activeId } = useArtifactPanel();
  const artifactId = `subagent-${runId}`;
  const isArtifactOpen = activeId === artifactId;
  const [dismissedToolIds, setDismissedToolIds] = useState<Set<string>>(
    new Set(),
  );
  const wasOpenRef = useRef(isArtifactOpen);

  const allPendingApprovals = useMemo(
    () => findPendingApprovals(content),
    [content],
  );

  const pendingApprovals = useMemo(
    () =>
      allPendingApprovals.filter((t) => !dismissedToolIds.has(t.toolCallId)),
    [allPendingApprovals, dismissedToolIds],
  );
  const previewText = useMemo(
    () => getPreviewText(content, isCompleted, hasError, cancelled, state),
    [content, isCompleted, hasError, cancelled, state],
  );

  useEffect(() => {
    wasOpenRef.current = isArtifactOpen;
  }, [isArtifactOpen]);

  useEffect(() => {
    if (wasOpenRef.current) {
      open(
        artifactId,
        memberName || "Agent",
        <SubAgentContent
          content={content}
          task={task}
          active={active}
          chatId={chatId}
        />,
      );
    }
  }, [content, task, active, artifactId, memberName, chatId, open]);

  const dismissCurrentTools = useCallback(() => {
    const ids = new Set(pendingApprovals.map((t) => t.toolCallId));
    setDismissedToolIds((prev) => new Set([...prev, ...ids]));
  }, [pendingApprovals]);

  const hasPending = pendingApprovals.length > 0;
  const pendingSubtitle = hasPending
    ? pendingApprovals.map((t) => formatToolName(t.toolName)).join(", ")
    : null;

  const handleClick = () => {
    if (hasPending) return;
    if (isArtifactOpen) {
      close();
    } else {
      open(
        artifactId,
        memberName || "Agent",
        <SubAgentContent
          content={content}
          task={task}
          active={active}
          chatId={chatId}
        />,
      );
    }
  };

  return (
    <div className="my-3 not-prose">
      <div
        className={cn(
          "w-full rounded-2xl border overflow-hidden transition-colors",
          isArtifactOpen
            ? "border-primary/40 bg-primary/5"
            : hasPending
              ? "border-primary/40 bg-card"
              : "border-border bg-card hover:bg-muted/50",
        )}
      >
        <button
          onClick={handleClick}
          className={cn(
            "w-full text-left px-4 py-4 flex items-center gap-3 transition-colors",
            !hasPending && "cursor-pointer",
            hasPending && "cursor-default",
            active && !hasPending && "shimmer",
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {memberName || "Agent"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {active && !isCompleted && !hasError && !hasPending && (
                <Loader2
                  size={12}
                  className="animate-spin text-muted-foreground shrink-0"
                />
              )}
              <span className="text-xs text-muted-foreground truncate">
                {pendingSubtitle ?? previewText}
              </span>
            </div>
          </div>
        </button>

        <AnimatePresence initial={false}>
          {hasPending && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/60 pt-4">
                <InlineApproval
                  tools={pendingApprovals}
                  onResolved={dismissCurrentTools}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
