"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, Loader2, Wrench } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from "motion/react";
import { cn } from "@/lib/utils";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { respondToToolApproval } from "@/python/api";
import { parseToolDisplayParts } from "@/lib/tooling";
import { ArgumentsDisplay } from "./tool-renderers/default/ArgumentsDisplay";
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

function TextBlock({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="px-4">
      <MarkdownRenderer content={content} />
    </div>
  );
}

function ErrorBlock({ content }: { content: string }) {
  return <div className="text-sm text-destructive px-5 py-1">{content}</div>;
}

function isBlockGroupable(block: ContentBlock): boolean {
  return block.type === "tool_call" || block.type === "reasoning";
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
        id={block.id}
        toolName={block.toolName}
        toolArgs={block.toolArgs}
        toolResult={block.toolResult}
        isCompleted={block.isCompleted}
        requiresApproval={block.requiresApproval}
        runId={block.runId}
        toolCallId={block.toolCallId || block.id}
        approvalStatus={block.approvalStatus}
        editableArgs={block.editableArgs}
        isGrouped={isGrouped}
        isFirst={isFirst}
        isLast={isLast}
        renderPlan={block.renderPlan}
        failed={block.failed}
        chatId={chatId}
      />
    );
  }

  if (block.type === "reasoning") {
    return (
      <ThinkingCall
        key={`think-${index}`}
        content={block.content}
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
      elements.push(<TextBlock key={`text-${i}`} content={block.content} />);
      i++;
      continue;
    }

    if (block.type === "error") {
      elements.push(<ErrorBlock key={`error-${i}`} content={block.content} />);
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

    i++;
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto space-y-1 pb-4"
    >
      {elements}
      <div ref={endOfContentRef} className="h-4" />
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
): string {
  if (hasError) return "Failed";
  if (cancelled) return "Cancelled";
  if (isCompleted) return "Completed";

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

function InlineApprovalToolEntry({
  tool,
  editedValues,
  onEditedChange,
}: {
  tool: PendingApproval;
  editedValues: Record<string, unknown>;
  onEditedChange: (key: string, value: unknown) => void;
}) {
  const hasArgs = Object.keys(tool.toolArgs || {}).length > 0;
  const { label, namespace } = parseToolDisplayParts(tool.toolName);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Wrench size={12} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-foreground">
          {label}
          {namespace && (
            <span className="px-1.5 italic text-muted-foreground">
              {namespace}
            </span>
          )}
        </span>
      </div>
      {hasArgs && (
        <ArgumentsDisplay
          args={tool.toolArgs}
          editableArgs={tool.editableArgs}
          editedValues={editedValues}
          onValueChange={onEditedChange}
        />
      )}
    </div>
  );
}

function InlineApproval({
  tools,
  onResolved,
}: {
  tools: PendingApproval[];
  onResolved?: () => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [editedValuesMap, setEditedValuesMap] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const runId = tools[0]?.runId;

  const updateEditedValue = (
    toolCallId: string,
    key: string,
    value: unknown,
  ) => {
    setEditedValuesMap((prev) => ({
      ...prev,
      [toolCallId]: { ...prev[toolCallId], [key]: value },
    }));
  };

  const submitApproval = async (approved: boolean) => {
    if (!runId || isProcessing) return;
    setIsProcessing(true);
    onResolved?.();

    const toolDecisions: Record<string, boolean> = {};
    const editedArgs: Record<string, Record<string, unknown>> = {};
    let hasEdits = false;

    for (const tool of tools) {
      toolDecisions[tool.toolCallId] = approved;
      const edits = editedValuesMap[tool.toolCallId];
      if (edits && Object.keys(edits).length > 0) {
        editedArgs[tool.toolCallId] = { ...tool.toolArgs, ...edits };
        hasEdits = true;
      }
    }

    try {
      await respondToToolApproval({
        body: {
          runId,
          approved,
          toolDecisions,
          editedArgs: hasEdits ? editedArgs : undefined,
        },
      });
    } catch (error) {
      console.error(`Failed to ${approved ? "approve" : "deny"} tools:`, error);
      setIsProcessing(false);
    }
  };

  return (
    <div className="px-4 pb-4 space-y-3">
      {tools.map((tool, idx) => (
        <div key={tool.toolCallId}>
          {idx > 0 && <div className="border-t border-border/40 pt-3" />}
          <InlineApprovalToolEntry
            tool={tool}
            editedValues={editedValuesMap[tool.toolCallId] ?? {}}
            onEditedChange={(key, value) =>
              updateEditedValue(tool.toolCallId, key, value)
            }
          />
        </div>
      ))}

      <div className="flex gap-2">
        <button
          onClick={() => submitApproval(true)}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors"
        >
          <Check size={14} />
          Approve{tools.length > 1 && ` All (${tools.length})`}
        </button>
        <button
          onClick={() => submitApproval(false)}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive hover:bg-destructive/90 disabled:bg-destructive/50 text-destructive-foreground rounded-md transition-colors"
        >
          <X size={14} />
          Deny
        </button>
      </div>
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
    () => getPreviewText(content, isCompleted, hasError, cancelled),
    [content, isCompleted, hasError, cancelled],
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
