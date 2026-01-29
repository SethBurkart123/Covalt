"use client";

import { useState, useEffect } from "react";
import { Check, X, Wrench } from "lucide-react";
import { respondToToolApproval } from "@/python/api";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { ArgumentsDisplay } from "./ArgumentsDisplay";
import { ResultRenderer } from "./ResultRenderer";

export function DefaultToolCall({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  requiresApproval = false,
  runId,
  toolCallId,
  approvalStatus: initialApprovalStatus,
  editableArgs,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ToolCallRendererProps) {
  const [approvalStatus, setApprovalStatus] = useState(initialApprovalStatus || "pending");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOpen, setIsOpen] = useState(requiresApproval && approvalStatus === "pending");
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (initialApprovalStatus && initialApprovalStatus !== approvalStatus) {
      setApprovalStatus(initialApprovalStatus);
      if (initialApprovalStatus !== "pending") {
        setIsOpen(false);
      }
    }
  }, [initialApprovalStatus, approvalStatus]);

  const handleValueChange = (key: string, value: unknown) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleApprove = async () => {
    if (!runId || !toolCallId || isProcessing) return;
    setIsProcessing(true);
    const editedArgs = Object.keys(editedValues).length > 0 
      ? { [toolCallId]: { ...toolArgs, ...editedValues } }
      : undefined;

    try {
      await respondToToolApproval({
        body: {
          runId,
          approved: true,
          toolDecisions: { [toolCallId]: true },
          editedArgs,
        },
      });
      setApprovalStatus("approved");
      setTimeout(() => setIsOpen(false), 300);
    } catch (error) {
      console.error("Failed to approve tool:", error);
      setIsProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!runId || !toolCallId || isProcessing) return;
    setIsProcessing(true);
    try {
      await respondToToolApproval({
        body: {
          runId,
          approved: false,
          toolDecisions: { [toolCallId]: false },
        },
      });
      setApprovalStatus("denied");
      setTimeout(() => setIsOpen(false), 300);
    } catch (error) {
      console.error("Failed to deny tool:", error);
      setIsProcessing(false);
    }
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted && approvalStatus !== "pending"}
      disableToggle={!(!requiresApproval || approvalStatus !== "pending")}
      data-toolcall
    >
      <CollapsibleTrigger>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Wrench} />
          <span className="text-sm font-mono text-foreground">
            {toolName.includes(":") ? (
              <>
                <span>{toolName.split(":").slice(1).join(":")}</span>
                <span className="px-2 italic text-muted-foreground align-middle">
                  {toolName.split(":")[0]}
                </span>
              </>
            ) : (
              toolName
            )}
          </span>
          {approvalStatus === "denied" && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400">
              Denied
            </span>
          )}
          {approvalStatus === "timeout" && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              Timed Out
            </span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Arguments
          </div>
          <ArgumentsDisplay
            args={toolArgs}
            editableArgs={requiresApproval && approvalStatus === "pending" ? editableArgs : undefined}
            editedValues={editedValues}
            onValueChange={handleValueChange}
          />
        </div>

        {requiresApproval && approvalStatus === "pending" && (
          <div className="flex gap-2 pt-2">
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
        )}

        {isCompleted && toolResult && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Result
            </div>
            <ResultRenderer content={toolResult} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
