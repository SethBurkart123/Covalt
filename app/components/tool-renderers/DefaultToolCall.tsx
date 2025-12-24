"use client";

import React, { useState } from "react";
import { Check, X, Wrench, Clock } from "lucide-react";
import { respondToToolApproval } from "@/python/api";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

function ArgumentsDisplay({
  args,
  editableArgs,
  editedValues,
  onValueChange,
}: {
  args: Record<string, unknown>;
  editableArgs?: string[] | boolean;
  editedValues?: Record<string, unknown>;
  onValueChange?: (key: string, value: unknown) => void;
}) {
  const isEditable = (key: string) => {
    if (!editableArgs || !onValueChange) return false;
    if (editableArgs === true) return true;
    return Array.isArray(editableArgs) && editableArgs.includes(key);
  };

  return (
    <div className="space-y-2">
      {Object.entries(args).map(([key, value]) => {
        const editable = isEditable(key);
        const displayValue = editedValues?.[key] ?? value;
        const isMultiline = typeof displayValue === "string" && displayValue.includes("\n");

        return (
          <div key={key}>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {key} <span className="italic opacity-50">{editable && "(editable)"}</span>
            </div>
            {editable && onValueChange ? (
              isMultiline ? (
                <textarea
                  className="w-full text-sm bg-background/15 px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[80px]"
                  value={typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue, null, 2)}
                  onChange={(e) => onValueChange(key, e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="w-full text-sm bg-background/15 px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  value={typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue)}
                  onChange={(e) => onValueChange(key, e.target.value)}
                />
              )
            ) : (
              <div className="w-full bg-background/5 text-sm px-3 py-2 rounded border border-border">
                {typeof displayValue === "string" ? displayValue : JSON.stringify(displayValue, null, 2)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DefaultResultRenderer({ content }: { content: string }) {
  return (
    <pre className="w-full text-xs bg-muted p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto">
      <code className="!bg-transparent">
        {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
      </code>
    </pre>
  );
}

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

  const handleValueChange = (key: string, value: unknown) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const getEditedArgs = () => {
    if (Object.keys(editedValues).length === 0) return undefined;
    return { ...toolArgs, ...editedValues };
  };

  const handleApprove = async () => {
    if (!runId || !toolCallId || isProcessing) return;
    setIsProcessing(true);
    try {
      await respondToToolApproval({
        body: {
          runId,
          approved: true,
          toolDecisions: { [toolCallId]: true },
          editedArgs: getEditedArgs() ? { [toolCallId]: getEditedArgs()! } : undefined,
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

  const showChevron = !requiresApproval || approvalStatus !== "pending";
  const showShimmer = !isCompleted && approvalStatus !== "pending";

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={showShimmer}
      disableToggle={!showChevron}
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
            <DefaultResultRenderer content={toolResult} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
