"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, X, Wrench, Clock } from "lucide-react";
import { respondToToolApproval } from "@/python/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ToolCallProps {
  toolName: string;
  toolArgs: Record<string, any>;
  toolResult?: string;
  isCompleted: boolean;
  renderer?: string;
  requiresApproval?: boolean;
  runId?: string;
  toolCallId?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  editableArgs?: string[] | boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function ArgumentsDisplay({
  args,
  editableArgs,
  editedValues,
  onValueChange,
}: {
  args: Record<string, any>;
  editableArgs?: string[] | boolean;
  editedValues?: Record<string, any>;
  onValueChange?: (key: string, value: any) => void;
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

export default function ToolCall({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  renderer,
  requiresApproval = false,
  runId,
  toolCallId,
  approvalStatus: initialApprovalStatus,
  editableArgs,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ToolCallProps) {
  const [approvalStatus, setApprovalStatus] = useState(
    initialApprovalStatus || "pending",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOpen, setIsOpen] = useState(
    requiresApproval && approvalStatus === "pending",
  );
  const [editedValues, setEditedValues] = useState<Record<string, any>>({});

  const handleValueChange = (key: string, value: any) => {
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
      const editedArgs = getEditedArgs();
      await respondToToolApproval({
        body: {
          runId,
          approved: true,
          toolDecisions: { [toolCallId]: true },
          editedArgs: editedArgs ? { [toolCallId]: editedArgs } : undefined,
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

  if (isGrouped) {
    return (
      <div className="relative" data-toolcall>
        <div
          className="absolute left-7 top-0 bottom-0 z-10 w-px bg-border"
          style={{
            top: isFirst ? "2.2rem" : "0",
            bottom: isLast ? "calc(100% - 0.7rem)" : "0",
          }}
        />

        <button
          onClick={() => showChevron && setIsOpen(!isOpen)}
          className={`w-full px-4 py-3 flex items-center justify-between hover:bg-border/30 transition-colors relative ${
            showShimmer ? "shimmer" : ""
          } ${!showChevron ? "cursor-default" : ""}`}
        >
          <div className="flex items-center gap-2">
            <div className="size-6 p-0.5 flex justify-center items-center relative z-10">
              <Wrench size={16} className="text-muted-foreground" />
            </div>
            <span className="text-sm font-mono text-foreground ml-2">
              {toolName}
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
          </div>
          {showChevron && (
            <motion.div
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={16} className="text-muted-foreground" />
            </motion.div>
          )}
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 270, damping: 30 }}
              className="overflow-hidden"
            >
              <div
                className={`px-4 pb-3 space-y-3 ${isLast ? "border-t border-border" : ""} pt-3 pl-9`}
              >
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

                {requiresApproval &&
                  approvalStatus === "approved" &&
                  !isCompleted && (
                    <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                      <Check size={14} />
                      <span>Approved - executing...</span>
                    </div>
                  )}

                {requiresApproval && approvalStatus === "denied" && (
                  <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                    <X size={14} />
                    <span>Operation was denied</span>
                  </div>
                )}

                {requiresApproval && approvalStatus === "timeout" && (
                  <div className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-400">
                    <Clock size={14} />
                    <span>Operation timed out</span>
                  </div>
                )}

                {isCompleted && toolResult && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      Result
                    </div>
                    {renderer === "markdown" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownRenderer content={toolResult} />
                      </div>
                    ) : (
                      <pre className="w-full text-xs bg-muted p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto">
                        <code className="!bg-transparent">
                          {typeof toolResult === "string"
                            ? toolResult
                            : JSON.stringify(toolResult, null, 2)}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="my-3 not-prose" data-toolcall>
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <button
          onClick={() => showChevron && setIsOpen(!isOpen)}
          className={`w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors ${
            showShimmer ? "shimmer" : ""
          } ${!showChevron ? "cursor-default" : ""}`}
        >
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-muted-foreground" />
            <span className="text-sm font-mono text-foreground">
              {toolName}
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
          </div>
          {showChevron && (
            <motion.div
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={16} className="text-muted-foreground" />
            </motion.div>
          )}
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 270, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-3 border-t border-border pt-3">
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

                {requiresApproval &&
                  approvalStatus === "approved" &&
                  !isCompleted && (
                    <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                      <Check size={14} />
                      <span>Approved - executing...</span>
                    </div>
                  )}

                {requiresApproval && approvalStatus === "denied" && (
                  <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                    <X size={14} />
                    <span>Operation was denied</span>
                  </div>
                )}

                {requiresApproval && approvalStatus === "timeout" && (
                  <div className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-400">
                    <Clock size={14} />
                    <span>Operation timed out</span>
                  </div>
                )}

                {isCompleted && toolResult && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      Result
                    </div>
                    {renderer === "markdown" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownRenderer content={toolResult} />
                      </div>
                    ) : (
                      <pre className="w-full text-xs bg-muted p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto">
                        <code className="!bg-transparent">
                          {typeof toolResult === "string"
                            ? toolResult
                            : JSON.stringify(toolResult, null, 2)}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
