import type {
  AllChatsData,
  Attachment,
  ChatData,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";
import type { Stream as StreamType } from "effect";
import type {
  ChatEvent,
  ChatMessagesPageResponse,
  ChatPageCursor,
  ChatPageResponse,
  ContinueMessageRequest,
  EditUserMessageRequest,
  RetryMessageRequest,
  StreamAgentChatRequest,
  StreamChatRequest,
  StreamFlowRunRequest,
  ZynkClient,
  ZynkError,
} from "@/python/api";
import {
  initZynk,
  getAllChats,
  listChatsPage,
  getChatMessagesPage,
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
  streamChat,
  streamAgentChat,
  streamFlowRun,
  continueMessage,
  retryMessage,
  editUserMessage,
  listNodeProviderPlugins,
  listNodeProviderDefinitions,
  installNodeProviderPluginFromRepo,
  importNodeProviderPluginFromDirectory,
  enableNodeProviderPlugin,
  uninstallNodeProviderPlugin,
  toAsyncIterable,
} from "@/python/api";
import { getBackendBaseUrl } from "@/lib/services/backend-url";
import { RUNTIME_EVENT, isTerminalRuntimeEvent } from "@/lib/services/runtime-events";

if (typeof window !== "undefined") {
  initZynk({ baseUrl: getBackendBaseUrl() });
}

interface StreamHandle {
  response: Response;
  abort: () => void;
}

function chatEventStreamToResponse(
  stream: StreamType.Stream<ChatEvent, ZynkError, ZynkClient>,
): StreamHandle {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    async start(rsController) {
      const sendEvent = (event: string, data: Record<string, unknown>) => {
        rsController.enqueue(encoder.encode(`event: ${event}\n`));
        rsController.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          rsController.close();
        } catch {}
      };

      try {
        for await (const evt of toAsyncIterable(stream)) {
          if (controller.signal.aborted) break;
          const { event, ...rest } = evt;
          const eventName = typeof event === "string" && event ? event : RUNTIME_EVENT.RUN_CONTENT;
          sendEvent(eventName, rest as Record<string, unknown>);
          if (isTerminalRuntimeEvent(eventName)) break;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          sendEvent(RUNTIME_EVENT.RUN_ERROR, { error: message });
        }
      } finally {
        close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  const response = new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

  return { response, abort: () => controller.abort() };
}

export const api = {
  getAllChats: (): Promise<AllChatsData> => getAllChats(),

  listChatsPage: (
    limit: number,
    cursor: ChatPageCursor | null,
    includeStarred: boolean,
  ): Promise<ChatPageResponse> =>
    listChatsPage({ body: { limit, cursor: cursor ?? undefined, includeStarred } }),

  getChatMessagesPage: (
    chatId: string,
    limit = 20,
    beforeMessageId?: string,
  ): Promise<ChatMessagesPageResponse> =>
    getChatMessagesPage({ body: { chatId, limit, beforeMessageId } }),

  createChat: (
    title?: string,
    model?: string,
    chatId?: string,
  ): Promise<ChatData> => createChat({ body: { id: chatId, title, model, agentConfig: undefined } }),

  deleteChat: (chatId: string): Promise<void> =>
    deleteChat({ body: { id: chatId } }),

  renameChat: (chatId: string, title: string): Promise<ChatData> =>
    updateChat({ body: { id: chatId, title, model: undefined } }),

  toggleStarChat: (chatId: string): Promise<ChatData> =>
    toggleStarChat({ body: { id: chatId } }),

  streamChat: (
    messages: readonly Message[],
    modelId: string,
    chatId?: string,
    toolIds?: readonly string[],
    attachments?: readonly Attachment[],
    modelOptions?: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ): StreamHandle => {
    const body: StreamChatRequest = {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        attachments:
          m.attachments?.map((a) => ({
            id: a.id,
            type: a.type,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
          })) || [],
      })),
      modelId,
      chatId,
      toolIds,
      modelOptions,
      variables,
      attachments:
        attachments?.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })) || [],
    };
    return chatEventStreamToResponse(streamChat({ body }));
  },

  streamAgentChat: (
    agentId: string,
    messages: readonly Message[],
    chatId?: string,
    ephemeral?: boolean,
    variables?: Record<string, unknown>,
  ): StreamHandle => {
    const body: StreamAgentChatRequest = {
      agentId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        attachments:
          m.attachments?.map((a) => ({
            id: a.id,
            type: a.type,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
          })) || [],
      })),
      chatId,
      ephemeral: ephemeral ?? false,
      variables,
    };
    return chatEventStreamToResponse(streamAgentChat({ body }));
  },

  streamFlowRun: (
    body: StreamFlowRunRequest,
  ): StreamHandle => chatEventStreamToResponse(streamFlowRun({ body })),

  continueMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: readonly string[],
    modelOptions?: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ): StreamHandle => {
    const body: ContinueMessageRequest = {
      messageId,
      chatId,
      modelId,
      toolIds,
      modelOptions,
      variables,
    };
    return chatEventStreamToResponse(continueMessage({ body }));
  },

  retryMessage: (
    messageId: string,
    chatId: string,
    modelId?: string,
    toolIds?: readonly string[],
    modelOptions?: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ): StreamHandle => {
    const body: RetryMessageRequest = {
      messageId,
      chatId,
      modelId,
      toolIds,
      modelOptions,
      variables,
    };
    return chatEventStreamToResponse(retryMessage({ body }));
  },

  editUserMessage: (
    messageId: string,
    newContent: string,
    chatId: string,
    modelId?: string,
    toolIds?: readonly string[],
    modelOptions?: Record<string, unknown>,
    existingAttachments?: readonly Attachment[],
    newAttachments?: readonly PendingAttachment[],
    variables?: Record<string, unknown>,
  ): StreamHandle => {
    const body: EditUserMessageRequest = {
      messageId,
      newContent,
      chatId,
      modelId,
      toolIds,
      modelOptions,
      variables,
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
    };
    return chatEventStreamToResponse(editUserMessage({ body }));
  },

  switchToSibling: (
    messageId: string,
    siblingId: string,
    chatId: string,
  ): Promise<void> =>
    switchToSibling({ body: { messageId, siblingId, chatId } }),

  getMessageSiblings: (messageId: string): Promise<MessageSibling[]> =>
    getMessageSiblings({ body: { messageId } }) as Promise<MessageSibling[]>,

  listNodeProviderPlugins: () => listNodeProviderPlugins(),

  listNodeProviderDefinitions: () => listNodeProviderDefinitions(),

  installNodeProviderPluginFromRepo: (
    repoUrl: string,
    ref?: string,
    pluginPath?: string,
  ) => installNodeProviderPluginFromRepo({ body: { repoUrl, ref, pluginPath } }),

  importNodeProviderPluginFromDirectory: (path: string) =>
    importNodeProviderPluginFromDirectory({ body: { path } }),

  enableNodeProviderPlugin: (id: string, enabled: boolean) =>
    enableNodeProviderPlugin({ body: { id, enabled } }),

  uninstallNodeProviderPlugin: (id: string) =>
    uninstallNodeProviderPlugin({ body: { id } }),

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
