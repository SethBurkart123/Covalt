import type {
  AllChatsData,
  Attachment,
  ChatData,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";
import {
  initBridge,
  getAllChats,
  getChat,
  createChat,
  deleteChat,
  updateChat,
  switchToSibling,
  getMessageSiblings,
  getMessageSiblingsBatch,
  cancelRun,
  cancelFlowRun,
  generateChatTitle,
  respondToThinkingTagPrompt,
  toggleStarChat,
} from "@/python/api";
import { createChannel, type BridgeError } from "@/python/_internal";
import { getBackendBaseUrl } from "@/lib/services/backend-url";

if (typeof window !== "undefined") {
  initBridge(getBackendBaseUrl());
}

interface StreamingChatEvent {
  event: string;
  [key: string]: unknown;
}

export interface StreamHandle {
  response: Response;
  abort: () => void;
}

function createStreamingResponse(channelName: string, body: Record<string, unknown>): StreamHandle {
  const encoder = new TextEncoder();
  const channel = createChannel<StreamingChatEvent>(channelName, { body });

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const sendEvent = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      channel.subscribe((evt: StreamingChatEvent) => {
        const { event, ...rest } = evt || {};

        sendEvent(event || "RunContent", rest);

        if (event === "RunCompleted" || event === "RunError" || event === "RunCancelled") {
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

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

  return { response, abort: () => channel.close() };
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
    modelOptions?: Record<string, unknown>,
  ): StreamHandle =>
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
      modelOptions,
      attachments:
        attachments?.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })) || [],
    }),

  streamAgentChat: (
    agentId: string,
    messages: Message[],
    chatId?: string,
    ephemeral?: boolean,
  ): StreamHandle =>
    createStreamingResponse("stream_agent_chat", {
      agentId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      chatId,
      ephemeral: ephemeral ?? false,
    }),

  streamFlowRun: (
    body: {
      agentId: string;
      mode: "execute" | "runFrom";
      targetNodeId: string;
      cachedOutputs?: Record<string, Record<string, unknown>>;
      promptInput?: Record<string, unknown>;
      nodeIds?: string[];
    }
  ): StreamHandle =>
    createStreamingResponse("stream_flow_run", body),

  continueMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
    modelOptions?: Record<string, unknown>,
  ): StreamHandle =>
    createStreamingResponse("continue_message", {
      messageId,
      chatId,
      modelId,
      toolIds,
      modelOptions,
    }),

  retryMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
    modelOptions?: Record<string, unknown>,
  ): StreamHandle =>
    createStreamingResponse("retry_message", {
      messageId,
      chatId,
      modelId,
      toolIds,
      modelOptions,
    }),

  editUserMessage: (
    messageId: string,
    newContent: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
    modelOptions?: Record<string, unknown>,
    existingAttachments?: Attachment[],
    newAttachments?: PendingAttachment[],
  ): StreamHandle =>
    createStreamingResponse("edit_user_message", {
      messageId,
      newContent,
      chatId,
      modelId,
      toolIds,
      modelOptions,
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

  getMessageSiblingsBatch: (
    chatId: string,
    messageIds: string[],
  ): Promise<Record<string, MessageSibling[]>> =>
    getMessageSiblingsBatch({ body: { chatId, messageIds } }) as Promise<
      Record<string, MessageSibling[]>
    >,


  cancelRun: (messageId: string): Promise<{ cancelled: boolean }> =>
    cancelRun({ body: { messageId } }) as Promise<{ cancelled: boolean }>,

  cancelFlowRun: (runId: string): Promise<void> =>
    cancelFlowRun({ body: { runId } }),

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
