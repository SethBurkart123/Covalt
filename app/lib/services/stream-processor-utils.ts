"use client";

import type {
  ApprovalRequiredPayload,
  ApprovalResolvedPayload,
  ToolCallPayload,
} from "@/lib/types/chat";

const warnedPayloads = new Set<string>();
const warnedUnknownEvents = new Set<string>();

function warnInvalidPayload(context: string, payload: unknown): void {
  if (warnedPayloads.has(context)) return;
  warnedPayloads.add(context);
  try {
    console.warn(`StreamProcessor invalid ${context} payload: ${JSON.stringify(payload)}`);
  } catch (error) {
    console.warn(`StreamProcessor invalid ${context} payload`, error);
  }
}

export function warnUnknownRuntimeEvent(eventType: string, payload: unknown): void {
  if (warnedUnknownEvents.has(eventType)) return;
  warnedUnknownEvents.add(eventType);
  try {
    console.warn(`StreamProcessor unknown runtime event ${eventType}: ${JSON.stringify(payload)}`);
  } catch (error) {
    console.warn(`StreamProcessor unknown runtime event ${eventType}`, error);
  }
}

export function coerceToolCallPayload(tool: unknown, context: string): ToolCallPayload | null {
  if (!tool || typeof tool !== "object") {
    warnInvalidPayload(context, tool);
    return null;
  }

  const payload = tool as ToolCallPayload;
  if (typeof payload.id !== "string" || typeof payload.toolName !== "string") {
    warnInvalidPayload(context, tool);
    return null;
  }
  if (!payload.toolArgs || typeof payload.toolArgs !== "object") {
    warnInvalidPayload(context, tool);
    return null;
  }
  return payload;
}

export function coerceApprovalRequiredPayload(
  tool: unknown,
  context: string,
): ApprovalRequiredPayload | null {
  if (!tool || typeof tool !== "object") {
    warnInvalidPayload(context, tool);
    return null;
  }

  const payload = tool as ApprovalRequiredPayload;
  if (!Array.isArray(payload.tools)) {
    warnInvalidPayload(context, tool);
    return null;
  }
  return payload;
}

export function coerceApprovalResolvedPayload(
  tool: unknown,
  context: string,
): ApprovalResolvedPayload | null {
  if (!tool || typeof tool !== "object") {
    warnInvalidPayload(context, tool);
    return null;
  }

  const payload = tool as ApprovalResolvedPayload;
  if (!Array.isArray(payload.tools)) {
    warnInvalidPayload(context, tool);
    return null;
  }
  return payload;
}

export function resetStreamProcessorWarningsForTests(): void {
  warnedPayloads.clear();
  warnedUnknownEvents.clear();
}
