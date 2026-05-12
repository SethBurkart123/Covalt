import type { ChatMessage } from "@/python/api";
import type { Message } from "@/lib/types/chat";

// The wire schema (ChatMessage) carries readonly arrays and a broad `role: string`,
// while the in-memory `Message` is the runtime domain shape with required `isComplete`,
// `sequence`, and a narrowed role union. This adapter is the single bridge between
// the two so the boundary cast lives in exactly one place. If/when the backend
// schema gets enriched to match the domain shape, this function becomes a noop.

function narrowRole(role: string): Message["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "assistant";
}

export function chatMessageToMessage(wire: ChatMessage): Message {
  return {
    id: wire.id,
    role: narrowRole(wire.role),
    content: wire.content as Message["content"],
    createdAt: wire.createdAt,
    parentMessageId: wire.parentMessageId,
    isComplete: wire.isComplete ?? true,
    sequence: wire.sequence ?? 0,
    modelUsed: wire.modelUsed,
    attachments: wire.attachments as Message["attachments"],
  };
}

export function chatMessagesToMessages(
  wires: readonly ChatMessage[] | undefined,
): Message[] {
  if (!wires) return [];
  return wires.map(chatMessageToMessage);
}
