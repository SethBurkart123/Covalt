"use client";

import type { ContentBlock } from "@/lib/types/chat";

export interface MemberBuffers {
  currentTextBlock: string;
  currentReasoningBlock: string;
}

export interface StreamCallbacks {
  onUpdate: (content: ContentBlock[]) => void;
  onSessionId?: (sessionId: string) => void;
  onMessageId?: (messageId: string) => void;
  onThinkTagDetected?: () => void;
  onEvent?: (eventType: string, payload: Record<string, unknown>) => void;
}

export interface StreamState {
  contentBlocks: ContentBlock[];
  currentTextBlock: string;
  currentReasoningBlock: string;
  thinkTagDetected: boolean;
  memberStates: Map<string, MemberBuffers>;
  textBlockBoundary: boolean;
}

export type MemberRunBlock = Extract<ContentBlock, { type: "member_run" }>;

export function createInitialState(): StreamState {
  return {
    contentBlocks: [],
    currentTextBlock: "",
    currentReasoningBlock: "",
    thinkTagDetected: false,
    memberStates: new Map(),
    textBlockBoundary: false,
  };
}

export function normalizeEventPayload(data: unknown): Record<string, unknown> {
  return (typeof data === "object" && data !== null
    ? data
    : { content: data }) as Record<string, unknown>;
}

export function flushTextBlock(state: StreamState): void {
  if (!state.currentTextBlock) return;
  state.contentBlocks.push({ type: "text", content: state.currentTextBlock });
  state.currentTextBlock = "";
}

export function flushReasoningBlock(state: StreamState): void {
  if (!state.currentReasoningBlock) return;
  state.contentBlocks.push({
    type: "reasoning",
    content: state.currentReasoningBlock,
    isCompleted: true,
  });
  state.currentReasoningBlock = "";
}

export function findMemberBlock(state: StreamState, runId: string): MemberRunBlock | null {
  for (let i = state.contentBlocks.length - 1; i >= 0; i--) {
    const block = state.contentBlocks[i];
    if (block.type === "member_run" && block.runId === runId) return block;
  }
  return null;
}

export function getMemberState(state: StreamState, runId: string): MemberBuffers {
  let memberState = state.memberStates.get(runId);
  if (!memberState) {
    memberState = { currentTextBlock: "", currentReasoningBlock: "" };
    state.memberStates.set(runId, memberState);
  }
  return memberState;
}

export function flushMemberText(block: MemberRunBlock, memberState: MemberBuffers): void {
  if (!memberState.currentTextBlock) return;
  block.content.push({ type: "text", content: memberState.currentTextBlock });
  memberState.currentTextBlock = "";
}

export function flushMemberReasoning(block: MemberRunBlock, memberState: MemberBuffers): void {
  if (!memberState.currentReasoningBlock) return;
  block.content.push({
    type: "reasoning",
    content: memberState.currentReasoningBlock,
    isCompleted: true,
  });
  memberState.currentReasoningBlock = "";
}

export function replaceBlocks(state: StreamState, blocks: ContentBlock[]): void {
  state.contentBlocks.splice(0, state.contentBlocks.length, ...blocks);
  state.currentTextBlock = "";
  state.currentReasoningBlock = "";
  state.textBlockBoundary = false;
}

export function buildCurrentContent(state: StreamState): ContentBlock[] {
  const content: ContentBlock[] = [];

  for (const block of state.contentBlocks) {
    if (block.type !== "member_run") {
      content.push(block);
      continue;
    }

    const memberState = state.memberStates.get(block.runId);
    if (!memberState || (!memberState.currentTextBlock && !memberState.currentReasoningBlock)) {
      content.push(block);
      continue;
    }

    const cloned: MemberRunBlock = { ...block, content: [...block.content] };
    if (memberState.currentTextBlock) {
      cloned.content.push({ type: "text", content: memberState.currentTextBlock });
    }
    if (memberState.currentReasoningBlock) {
      cloned.content.push({
        type: "reasoning",
        content: memberState.currentReasoningBlock,
        isCompleted: false,
      });
    }
    content.push(cloned);
  }

  if (state.currentTextBlock) {
    content.push({ type: "text", content: state.currentTextBlock });
  }
  if (state.currentReasoningBlock) {
    content.push({
      type: "reasoning",
      content: state.currentReasoningBlock,
      isCompleted: false,
    });
  }

  if (content.length === 0) {
    content.push({ type: "text", content: "" });
  }

  return content;
}

export function scheduleUpdate(state: StreamState, onUpdate: (content: ContentBlock[]) => void): void {
  requestAnimationFrame(() => onUpdate(buildCurrentContent(state)));
}
