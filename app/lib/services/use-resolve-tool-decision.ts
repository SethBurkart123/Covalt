"use client";

import { useCallback } from "react";
import { respondToToolDecision } from "@/python/api";
import type { ApprovalOutcome, ApprovalResolveResult } from "@/lib/renderers";

export function useResolveToolDecision(
  runId: string,
  toolCallId: string,
): (outcome: ApprovalOutcome) => Promise<ApprovalResolveResult> {
  return useCallback(
    async (outcome: ApprovalOutcome) => {
      const editedArgs = outcome.answers?.length
        ? { ...outcome.editedArgs, answers: outcome.answers }
        : outcome.editedArgs;
      const result = await respondToToolDecision({
        body: {
          runId,
          toolCallId,
          selectedOption: outcome.selectedOption,
          editedArgs: editedArgs ?? undefined,
          cancelled: outcome.cancelled ?? false,
        },
      });
      const matched = (result as { matched?: boolean }).matched !== false;
      if (!matched) {
        console.error(
          `[useResolveToolDecision] No pending tool decision matched ${toolCallId}`,
        );
      }
      return { matched };
    },
    [runId, toolCallId],
  );
}
