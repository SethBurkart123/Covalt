import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(cb: T) => cb,
}));

vi.mock("@/python/api", () => ({
  respondToToolDecision: vi.fn(),
}));

import { respondToToolDecision } from "@/python/api";
import { useResolveToolDecision } from "./use-resolve-tool-decision";

const respondMock = vi.mocked(respondToToolDecision);

describe("useResolveToolDecision", () => {
  it("moves user answers into editedArgs for the tool-decision API", async () => {
    respondMock.mockResolvedValueOnce({ success: true, matched: true });

    await useResolveToolDecision("run-1", "tool-1")({
      selectedOption: "submit",
      answers: [{ index: 0, answer: "Covalt" }],
    });

    expect(respondMock).toHaveBeenCalledWith({
      body: {
        runId: "run-1",
        toolCallId: "tool-1",
        selectedOption: "submit",
        editedArgs: { answers: [{ index: 0, answer: "Covalt" }] },
        cancelled: false,
      },
    });
  });

  it("keeps the approval visible when the backend has no matching session", async () => {
    respondMock.mockResolvedValueOnce({ success: true, matched: false });

    await expect(
      useResolveToolDecision("run-1", "missing")({ selectedOption: "allow_once" }),
    ).resolves.toEqual({ matched: false });
  });
});
