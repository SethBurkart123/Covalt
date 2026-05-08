"use client";

import { useCallback } from "react";
import { respondToApproval } from "@/python/api";
import type { ApprovalOutcome } from "@/lib/renderers";

export function useResolveApproval(
  runId: string,
  requestId: string,
): (outcome: ApprovalOutcome) => Promise<void> {
  return useCallback(
    async (outcome: ApprovalOutcome) => {
      await respondToApproval({
        body: {
          runId,
          requestId,
          selectedOption: outcome.selectedOption,
          answers: outcome.answers ?? [],
          editedArgs: outcome.editedArgs ?? undefined,
          cancelled: outcome.cancelled ?? false,
        },
      });
    },
    [runId, requestId],
  );
}
