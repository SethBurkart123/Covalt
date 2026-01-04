import type {
  AllChatsData,
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
  cancelRun,
  generateChatTitle,
  respondToThinkingTagPrompt,
  reprocessMessageThinkTags,
} from "@/python/api";
import { createChannel } from "@/python/_internal";
import type { BridgeError } from "@/python/_internal";

// Initialize the bridge - call this once at app startup
// The backend runs on port 8000 as configured in backend/main.py
initBridge("http://127.0.0.1:8000");

// Type for streaming chat events from the backend
interface StreamingChatEvent {
  event: string;
  content?: string;
  sessionId?: string;
  reasoningContent?: string;
  tool?: unknown;
  blocks?: unknown[];
  error?: string;
}

class ApiService {
  private static instance: ApiService;

  private constructor() {}

  static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  async getAllChats(): Promise<AllChatsData> {
    return getAllChats();
  }

  async getChat(chatId: string): Promise<{ id: string; messages: Message[] }> {
    return getChat({ body: { id: chatId } }) as Promise<{
      id: string;
      messages: Message[];
    }>;
  }

  async createChat(
    title?: string,
    model?: string,
    chatId?: string,
  ): Promise<ChatData> {
    return createChat({ body: { id: chatId, title, model } });
  }

  async deleteChat(chatId: string): Promise<void> {
    return deleteChat({ body: { id: chatId } });
  }

  async renameChat(chatId: string, title: string): Promise<ChatData> {
    return updateChat({ body: { id: chatId, title } });
  }

  async streamChat(
    messages: Message[],
    modelId: string,
    chatId?: string,
    toolIds?: string[],
    attachments?: PendingAttachment[],
  ): Promise<Response> {
    // Use zynk's createChannel for streaming - it returns a BridgeChannel
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enqueueLine = (line: string) =>
          controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, unknown>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Create a zynk channel for streaming
        const channel = createChannel<StreamingChatEvent>("stream_chat", {
          body: {
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
            modelId: modelId,
            chatId: chatId,
            toolIds: toolIds,
            // Include attachments with base64 data for backend processing
            attachments: attachments?.map((a) => ({
              id: a.id,
              type: a.type,
              name: a.name,
              mimeType: a.mimeType,
              size: a.size,
              data: a.data,
            })) || [],
          },
        });

        // Subscribe to channel events
        channel.subscribe((evt: StreamingChatEvent) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, unknown> = {};

          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === "string") data.content = rest.content;
          if (typeof rest.error === "string") data.error = rest.error;
          if (typeof rest.reasoningContent === "string")
            data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          if (Array.isArray(rest.blocks)) data.blocks = rest.blocks;

          sendEvent(event || "RunContent", data);

          if (event === "RunCompleted" || event === "RunError") {
            controller.close();
            channel.close();
          }
        });

        // Handle channel close
        channel.onClose(() => {
          controller.close();
        });

        // Handle channel errors
        channel.onError((error: BridgeError) => {
          sendEvent("RunError", { error: error.message });
          controller.close();
        });
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  async continueMessage(
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
  ): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enqueueLine = (line: string) =>
          controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, unknown>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const channel = createChannel<StreamingChatEvent>("continue_message", {
          body: {
            messageId,
            chatId,
            modelId,
            toolIds,
          },
        });

        channel.subscribe((evt: StreamingChatEvent) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, unknown> = {};

          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === "string") data.content = rest.content;
          if (typeof rest.error === "string") data.error = rest.error;
          if (typeof rest.reasoningContent === "string")
            data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          if (Array.isArray(rest.blocks)) data.blocks = rest.blocks;

          sendEvent(event || "RunContent", data);

          if (event === "RunCompleted" || event === "RunError") {
            controller.close();
            channel.close();
          }
        });

        channel.onClose(() => {
          controller.close();
        });

        channel.onError((error: BridgeError) => {
          sendEvent("RunError", { error: error.message });
          controller.close();
        });
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  async retryMessage(
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
  ): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enqueueLine = (line: string) =>
          controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, unknown>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const channel = createChannel<StreamingChatEvent>("retry_message", {
          body: {
            messageId,
            chatId,
            modelId,
            toolIds,
          },
        });

        channel.subscribe((evt: StreamingChatEvent) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, unknown> = {};

          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === "string") data.content = rest.content;
          if (typeof rest.error === "string") data.error = rest.error;
          if (typeof rest.reasoningContent === "string")
            data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;

          sendEvent(event || "RunContent", data);

          if (event === "RunCompleted" || event === "RunError") {
            controller.close();
            channel.close();
          }
        });

        channel.onClose(() => {
          controller.close();
        });

        channel.onError((error: BridgeError) => {
          sendEvent("RunError", { error: error.message });
          controller.close();
        });
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  async editUserMessage(
    messageId: string,
    newContent: string,
    chatId: string,
    modelId?: string,
    toolIds?: string[],
  ): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enqueueLine = (line: string) =>
          controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, unknown>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const channel = createChannel<StreamingChatEvent>("edit_user_message", {
          body: {
            messageId,
            newContent,
            chatId,
            modelId,
            toolIds,
          },
        });

        channel.subscribe((evt: StreamingChatEvent) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, unknown> = {};

          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === "string") data.content = rest.content;
          if (typeof rest.error === "string") data.error = rest.error;
          if (typeof rest.reasoningContent === "string")
            data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;

          sendEvent(event || "RunContent", data);

          if (event === "RunCompleted" || event === "RunError") {
            controller.close();
            channel.close();
          }
        });

        channel.onClose(() => {
          controller.close();
        });

        channel.onError((error: BridgeError) => {
          sendEvent("RunError", { error: error.message });
          controller.close();
        });
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  async switchToSibling(
    messageId: string,
    siblingId: string,
    chatId: string,
  ): Promise<void> {
    return switchToSibling({ body: { messageId, siblingId, chatId } });
  }

  async getMessageSiblings(messageId: string): Promise<MessageSibling[]> {
    return getMessageSiblings({ body: { messageId } }) as Promise<
      MessageSibling[]
    >;
  }

  async cancelRun(messageId: string): Promise<{ cancelled: boolean }> {
    return cancelRun({ body: { messageId } }) as Promise<{
      cancelled: boolean;
    }>;
  }

  async generateChatTitle(chatId: string): Promise<{ title: string | null }> {
    return generateChatTitle({ body: { id: chatId } }) as Promise<{
      title: string | null;
    }>;
  }

  async respondToThinkingTagPrompt(
    provider: string,
    modelId: string,
    accepted: boolean,
  ): Promise<void> {
    return respondToThinkingTagPrompt({
      body: { provider, modelId, accepted },
    });
  }

  async reprocessMessageThinkTags(
    messageId: string,
  ): Promise<{ success: boolean }> {
    return reprocessMessageThinkTags({ body: { messageId } }) as Promise<{
      success: boolean;
    }>;
  }
}

export const api = ApiService.getInstance();
