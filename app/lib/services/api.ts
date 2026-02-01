import type {
  AllChatsData,
  Attachment,
  ChatData,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";
import {
  getAllChats,
  getChat,
  createChat,
  deleteChat,
  updateChat,
  switchToSibling,
  getMessageSiblings,
  cancelRun,
  generateChatTitle,
  respondToThinkingTagPrompt,
  toggleStarChat,
} from "@/python/api";
import { createChannel, type BridgeError } from "@/python/_internal";

// Import triggers auto-initialization
import "@/lib/bridge-init";

interface StreamingChatEvent {
  event: string;
  content?: string;
  sessionId?: string;
  reasoningContent?: string;
  tool?: unknown;
  blocks?: unknown[];
  error?: string;
}

function createStreamingResponse(channelName: string, body: Record<string, unknown>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const sendEvent = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const channel = createChannel<StreamingChatEvent>(channelName, { body });

      channel.subscribe((evt: StreamingChatEvent) => {
        const { event, ...rest } = evt || {};
        const data: Record<string, unknown> = {};

        if (rest.sessionId) data.sessionId = rest.sessionId;
        if (typeof rest.content === "string") data.content = rest.content;
        if (typeof rest.error === "string") data.error = rest.error;
        if (typeof rest.reasoningContent === "string") data.reasoningContent = rest.reasoningContent;
        if (rest.tool) data.tool = rest.tool;
        if (Array.isArray(rest.blocks)) data.blocks = rest.blocks;

        sendEvent(event || "RunContent", data);

        if (event === "RunCompleted" || event === "RunError") {
          controller.close();
          channel.close();
        }
      });

      channel.onClose(() => controller.close());
      channel.onError((error: BridgeError) => {
        sendEvent("RunError", { error: error.message });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const api = {
  getAllChats: (): Promise<AllChatsData> => getAllChats(),

  getChat: (chatId: string): Promise<{ id: string; messages: Message[] }> =>
    getChat({ body: { id: chatId } }) as Promise<{
      id: string;
      messages: Message[];
    }>,

  createChat: (
    title?: string,
    model?: string,
    chatId?: string,
  ): Promise<ChatData> => createChat({ body: { id: chatId, title, model } }),

  deleteChat: (chatId: string): Promise<void> =>
    deleteChat({ body: { id: chatId } }),

  renameChat: (chatId: string, title: string): Promise<ChatData> =>
    updateChat({ body: { id: chatId, title } }),

  toggleStarChat: (chatId: string): Promise<ChatData> =>
    toggleStarChat({ body: { id: chatId } }),

  streamChat: (
    messages: Message[],
    modelId: string,
    chatId?: string,
    toolIds?: string[],
    attachments?: Attachment[],
  ): Response =>
    createStreamingResponse("stream_chat", {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      modelId,
      chatId,
      toolIds,
      attachments:
        attachments?.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })) || [],
    }),

  continueMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
  ): Response =>
    createStreamingResponse("continue_message", {
      messageId,
      chatId,
      modelId,
      toolIds,
    }),

  retryMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
  ): Response =>
    createStreamingResponse("retry_message", {
      messageId,
      chatId,
      modelId,
      toolIds,
    }),

  editUserMessage: (
    messageId: string,
    newContent: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
    existingAttachments?: Attachment[],
    newAttachments?: PendingAttachment[],
  ): Response =>
    createStreamingResponse("edit_user_message", {
      messageId,
      newContent,
      chatId,
      modelId,
      toolIds,
      existingAttachments:
        existingAttachments?.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })) || [],
      newAttachments:
        newAttachments?.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          data: a.data,
        })) || [],
    }),

  switchToSibling: (
    messageId: string,
    siblingId: string,
    chatId: string,
  ): Promise<void> =>
    switchToSibling({ body: { messageId, siblingId, chatId } }),

  getMessageSiblings: (messageId: string): Promise<MessageSibling[]> =>
    getMessageSiblings({ body: { messageId } }) as Promise<MessageSibling[]>,

  cancelRun: (messageId: string): Promise<{ cancelled: boolean }> =>
    cancelRun({ body: { messageId } }) as Promise<{ cancelled: boolean }>,

  generateChatTitle: (chatId: string): Promise<{ title: string | null }> =>
    generateChatTitle({ body: { id: chatId } }) as Promise<{
      title: string | null;
    }>,

  respondToThinkingTagPrompt: (
    provider: string,
    modelId: string,
    accepted: boolean,
  ): Promise<void> =>
    respondToThinkingTagPrompt({ body: { provider, modelId, accepted } }),
};
