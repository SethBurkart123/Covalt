import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVENT,
  isFlowNodeRuntimeEvent,
  isKnownRuntimeEvent,
  isMemberRuntimeEvent,
  isTerminalRuntimeEvent,
  isToolRuntimeEvent,
} from "@/lib/services/runtime-events";

describe("runtime-events", () => {
  it("recognizes known runtime events", () => {
    expect(isKnownRuntimeEvent(RUNTIME_EVENT.RUN_STARTED)).toBe(true);
    expect(isKnownRuntimeEvent(RUNTIME_EVENT.TOOL_APPROVAL_REQUIRED)).toBe(true);
    expect(isKnownRuntimeEvent("NotARealEvent")).toBe(false);
  });

  it("classifies terminal events", () => {
    expect(isTerminalRuntimeEvent(RUNTIME_EVENT.RUN_COMPLETED)).toBe(true);
    expect(isTerminalRuntimeEvent(RUNTIME_EVENT.RUN_CANCELLED)).toBe(true);
    expect(isTerminalRuntimeEvent(RUNTIME_EVENT.RUN_ERROR)).toBe(true);
    expect(isTerminalRuntimeEvent(RUNTIME_EVENT.RUN_CONTENT)).toBe(false);
  });

  it("classifies tool, member and flow-node events", () => {
    expect(isToolRuntimeEvent(RUNTIME_EVENT.TOOL_CALL_STARTED)).toBe(true);
    expect(isToolRuntimeEvent(RUNTIME_EVENT.TOOL_APPROVAL_RESOLVED)).toBe(true);
    expect(isToolRuntimeEvent(RUNTIME_EVENT.RUN_STARTED)).toBe(false);

    expect(isMemberRuntimeEvent(RUNTIME_EVENT.MEMBER_RUN_STARTED)).toBe(true);
    expect(isMemberRuntimeEvent(RUNTIME_EVENT.MEMBER_RUN_ERROR)).toBe(true);
    expect(isMemberRuntimeEvent(RUNTIME_EVENT.TOOL_CALL_STARTED)).toBe(false);

    expect(isFlowNodeRuntimeEvent(RUNTIME_EVENT.FLOW_NODE_STARTED)).toBe(true);
    expect(isFlowNodeRuntimeEvent(RUNTIME_EVENT.FLOW_NODE_RESULT)).toBe(true);
    expect(isFlowNodeRuntimeEvent(RUNTIME_EVENT.RUN_ERROR)).toBe(false);
  });
});
