"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  chatId?: string;
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
  const rendered: React.ReactNode[] = [];

  if (task) {
    rendered.push(
      <div key="task-prompt" className="flex justify-end px-4 pt-4">
        <div className="rounded-3xl text-sm leading-relaxed bg-muted text-muted-foreground px-5 py-2.5 max-w-[85%]">
          <MarkdownRenderer content={task} trimLast />
        </div>
      </div>,
    );
  }

  for (let i = 0; i < content.length; i++) {
    const block = content[i];

    if (block.type === "text") {
      if (block.content && block.content.trim() !== "") {
        rendered.push(
          <div key={`text-${i}`} className="px-4">
            <MarkdownRenderer content={block.content} />
          </div>,
        );
      }
      continue;
    }

    if (block.type === "error") {
      rendered.push(
        <div key={`error-${i}`} className="text-sm text-destructive px-5 py-1">
          {block.content}
        </div>,
      );
      continue;
    }

    if (block.type === "tool_call" || block.type === "reasoning") {
      const start = i;
      const group: ContentBlock[] = [];
      let j = i;

      while (j < content.length) {
        const b = content[j];
        if (b.type === "tool_call" || b.type === "reasoning") {
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

      const groupItems = group.map((b, idx) => {
        if (b.type === "tool_call") {
          return (
            <ToolCall
              key={b.id || `tool-${start}-${idx}`}
              id={b.id}
              toolName={b.toolName}
              toolArgs={b.toolArgs}
              toolResult={b.toolResult}
              isCompleted={b.isCompleted}
              requiresApproval={b.requiresApproval}
              runId={b.runId}
              toolCallId={b.toolCallId || b.id}
              approvalStatus={b.approvalStatus}
              editableArgs={b.editableArgs}
              isGrouped={group.length > 1}
              isFirst={idx === 0}
              isLast={idx === group.length - 1}
              renderPlan={b.renderPlan}
              failed={b.failed}
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
              active={!b.isCompleted && !!active}
              isCompleted={b.isCompleted}
            />
          );
        }
        return null;
      });

      if (group.length === 1) {
        rendered.push(
          <div key={`group-${start}`} className="px-4">
            {groupItems[0]}
          </div>,
        );
      } else if (group.length > 1) {
        rendered.push(
          <div key={`group-${start}`} className="px-4 my-3 not-prose">
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              {groupItems}
            </div>
          </div>,
        );
      }
    }
  }

  return <div className="space-y-1 pb-4">{rendered}</div>;
}

type PendingApproval = Extract<ContentBlock, { type: "tool_call" }> & {
  requiresApproval: true;
  approvalStatus: "pending";
};

function findPendingApproval(content: ContentBlock[]): PendingApproval | null {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (
      block.type === "tool_call" &&
      block.requiresApproval &&
      block.approvalStatus === "pending"
    ) {
      return block as PendingApproval;
    }
  }
  return null;
}

function formatToolName(toolName: string): string {
  const { label, namespace } = parseToolDisplayParts(toolName);
  return namespace ? `${namespace}, ${label}` : label;
}

function getPreviewText(content: ContentBlock[], isCompleted: boolean, hasError: boolean): string {
  if (hasError) return "Failed";
  if (isCompleted) return "Completed";

  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block.type === "tool_call" && !block.isCompleted) {
      return `Running ${formatToolName(block.toolName)}`;
    }
    if (block.type === "tool_call" && block.isCompleted) {
      return `Ran ${formatToolName(block.toolName)}`;
    }
    if (block.type === "reasoning" && !block.isCompleted) {
      return "Thinking...";
    }
  }

  const hasAnyContent = content.some(
    (b) => b.type === "text" ? b.content.trim() !== "" : true,
  );
  if (hasAnyContent) return "Working...";
  return "Starting...";
}

function InlineApproval({ tool }: { tool: PendingApproval }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  const hasArgs = Object.keys(tool.toolArgs || {}).length > 0;

  const handleApprove = async () => {
    if (!tool.runId || !tool.toolCallId || isProcessing) return;
    setIsProcessing(true);
    const editedArgs = Object.keys(editedValues).length > 0
      ? { [tool.toolCallId]: { ...tool.toolArgs, ...editedValues } }
      : undefined;
    try {
      await respondToToolApproval({
        body: {
          runId: tool.runId,
          approved: true,
          toolDecisions: { [tool.toolCallId]: true },
          editedArgs,
        },
      });
    } catch (error) {
      console.error("Failed to approve tool:", error);
      setIsProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!tool.runId || !tool.toolCallId || isProcessing) return;
    setIsProcessing(true);
    try {
      await respondToToolApproval({
        body: {
          runId: tool.runId,
          approved: false,
          toolDecisions: { [tool.toolCallId]: false },
        },
      });
    } catch (error) {
      console.error("Failed to deny tool:", error);
      setIsProcessing(false);
    }
  };

  return (
    <div className="px-4 pb-4 space-y-3">
      {hasArgs && (
        <ArgumentsDisplay
          args={tool.toolArgs}
          editableArgs={tool.editableArgs}
          editedValues={editedValues}
          onValueChange={(key, value) =>
            setEditedValues((prev) => ({ ...prev, [key]: value }))
          }
        />
      )}

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors"
        >
          <Check size={14} />
          Approve
        </button>
        <button
          onClick={handleDeny}
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
  chatId,
}: SubAgentCardProps) {
  const { open, close, activeId } = useArtifactPanel();
  const artifactId = `subagent-${runId}`;
  const isArtifactOpen = activeId === artifactId;

  const pendingApproval = useMemo(() => findPendingApproval(content), [content]);

  const previewText = useMemo(
    () => getPreviewText(content, isCompleted, hasError),
    [content, isCompleted, hasError],
  );

  const wasOpenRef = useRef(false);
  useEffect(() => {
    wasOpenRef.current = isArtifactOpen;
  }, [isArtifactOpen]);

  useEffect(() => {
    if (wasOpenRef.current) {
      open(
        artifactId,
        memberName || "Agent",
        <SubAgentContent content={content} task={task} active={active} chatId={chatId} />,
      );
    }
  }, [content, task, active, artifactId, memberName, chatId, open]);

  const handleClick = () => {
    if (pendingApproval) return;
    if (isArtifactOpen) {
      close();
    } else {
      open(
        artifactId,
        memberName || "Agent",
        <SubAgentContent content={content} task={task} active={active} chatId={chatId} />,
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
            : pendingApproval
              ? "border-primary/40 bg-card"
              : "border-border bg-card hover:bg-muted/50",
        )}
      >
        <button
          onClick={handleClick}
          className={cn(
            "w-full text-left px-4 py-4 flex items-center gap-3 transition-colors",
            !pendingApproval && "cursor-pointer",
            pendingApproval && "cursor-default",
            active && !pendingApproval && "shimmer",
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {memberName || "Agent"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {active && !isCompleted && !hasError && !pendingApproval && (
                <Loader2 size={12} className="animate-spin text-muted-foreground flex-shrink-0" />
              )}
              <span className="text-xs text-muted-foreground truncate">
                {pendingApproval
                  ? formatToolName(pendingApproval.toolName)
                  : previewText}
              </span>
            </div>
          </div>
        </button>

        <AnimatePresence initial={false}>
          {pendingApproval && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/60 pt-4">
                <InlineApproval tool={pendingApproval} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
