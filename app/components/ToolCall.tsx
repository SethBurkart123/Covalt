"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, X, Wrench } from "lucide-react";
import { respondToToolApproval } from "@/python/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ToolCallProps {
  toolName: string;
  toolArgs: Record<string, any>;
  toolResult?: string;
  isCompleted: boolean;
  renderer?: string;
  requiresApproval?: boolean;
  approvalId?: string;
  approvalStatus?: "pending" | "approved" | "denied";
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function ArgumentsDisplay({ args }: { args: Record<string, any> }) {
  return (
    <div className="space-y-2">
      {Object.entries(args).map(([key, value]) => (
        <div key={key}>
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {key}
          </div>
          <div className="w-full text-sm bg-muted px-3 py-2 rounded border border-border">
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </div>
        </div>
      ))}
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
  approvalId,
  approvalStatus: initialApprovalStatus,
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

  const handleApprove = async () => {
    if (!approvalId || isProcessing) return;
    setIsProcessing(true);
    try {
      await respondToToolApproval({
        body: {
          approvalId,
          approved: true,
          editedArgs: undefined,
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
    if (!approvalId || isProcessing) return;
    setIsProcessing(true);
    try {
      await respondToToolApproval({
        body: {
          approvalId,
          approved: false,
          editedArgs: undefined,
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
                  <ArgumentsDisplay args={toolArgs} />
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
                  <ArgumentsDisplay args={toolArgs} />
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
