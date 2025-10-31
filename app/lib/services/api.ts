import type { AllChatsData, ChatData, Message, MessageSibling } from '@/lib/types/chat';

async function invoke<T = any>(cmd: string, body?: any): Promise<T> {
  const { pyInvoke } = await import('tauri-plugin-pytauri-api');
  return pyInvoke(cmd, body as any) as Promise<T>;
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
    return invoke<AllChatsData>('get_all_chats');
  }

  async getChat(chatId: string): Promise<{ id: string; messages: Message[] }> {
    return invoke<{ id: string; messages: Message[] }>('get_chat', { id: chatId });
  }

  async createChat(title?: string, model?: string, chatId?: string): Promise<ChatData> {
    return invoke<ChatData>('create_chat', { id: chatId, title, model });
  }

  async deleteChat(chatId: string): Promise<void> {
    return invoke<void>('delete_chat', { id: chatId });
  }

  async renameChat(chatId: string, title: string): Promise<ChatData> {
    return invoke<ChatData>('update_chat', { id: chatId, title });
  }

  async streamChat(
    messages: Message[],
    modelId: string,
    chatId?: string,
  ): Promise<Response> {
    // Bridge PyTauri Channel events into an SSE-compatible ReadableStream
    const encoder = new TextEncoder();
    const { Channel } = await import('@tauri-apps/api/core');
    const { pyInvoke } = await import('tauri-plugin-pytauri-api');

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const enqueueLine = (line: string) => controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, any>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const chatChannel = new Channel((evt: { 
          event: string; 
          content?: string; 
          sessionId?: string;
          reasoningContent?: string;
          tool?: any;
        }) => {
          const { event, ...rest } = evt || ({} as any);
          const data: Record<string, any> = {};
          
          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === 'string') data.content = rest.content;
          if (typeof rest.reasoningContent === 'string') data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          
          sendEvent(event || 'RunContent', data);
          
          if (event === 'RunCompleted' || event === 'RunError') {
            controller.close();
          }
        });

        try {
          // Pass channel and payload data in the body object
          await pyInvoke('stream_chat', {
            channel: chatChannel.toJSON(),
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt
            })),
            modelId: modelId,
            chatId: chatId,
          });
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  async continueMessage(messageId: string, chatId: string): Promise<Response> {
    const encoder = new TextEncoder();
    const { Channel } = await import('@tauri-apps/api/core');
    const { pyInvoke } = await import('tauri-plugin-pytauri-api');

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const enqueueLine = (line: string) => controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, any>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const chatChannel = new Channel((evt: any) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, any> = {};
          
          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === 'string') data.content = rest.content;
          if (typeof rest.reasoningContent === 'string') data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          
          sendEvent(event || 'RunContent', data);
          
          if (event === 'RunCompleted' || event === 'RunError') {
            controller.close();
          }
        });

        try {
          await pyInvoke('continue_message', {
            channel: chatChannel.toJSON(),
            messageId,
            chatId,
          });
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  async retryMessage(messageId: string, chatId: string): Promise<Response> {
    const encoder = new TextEncoder();
    const { Channel } = await import('@tauri-apps/api/core');
    const { pyInvoke } = await import('tauri-plugin-pytauri-api');

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const enqueueLine = (line: string) => controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, any>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const chatChannel = new Channel((evt: any) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, any> = {};
          
          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === 'string') data.content = rest.content;
          if (typeof rest.reasoningContent === 'string') data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          
          sendEvent(event || 'RunContent', data);
          
          if (event === 'RunCompleted' || event === 'RunError') {
            controller.close();
          }
        });

        try {
          await pyInvoke('retry_message', {
            channel: chatChannel.toJSON(),
            messageId,
            chatId,
          });
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  async editUserMessage(messageId: string, newContent: string, chatId: string): Promise<Response> {
    const encoder = new TextEncoder();
    const { Channel } = await import('@tauri-apps/api/core');
    const { pyInvoke } = await import('tauri-plugin-pytauri-api');

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const enqueueLine = (line: string) => controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, any>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        const chatChannel = new Channel((evt: any) => {
          const { event, ...rest } = evt || {};
          const data: Record<string, any> = {};
          
          if (rest.sessionId) data.sessionId = rest.sessionId;
          if (typeof rest.content === 'string') data.content = rest.content;
          if (typeof rest.reasoningContent === 'string') data.reasoningContent = rest.reasoningContent;
          if (rest.tool) data.tool = rest.tool;
          
          sendEvent(event || 'RunContent', data);
          
          if (event === 'RunCompleted' || event === 'RunError') {
            controller.close();
          }
        });

        try {
          await pyInvoke('edit_user_message', {
            channel: chatChannel.toJSON(),
            messageId,
            newContent,
            chatId,
          });
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  async switchToSibling(messageId: string, siblingId: string, chatId: string): Promise<void> {
    return invoke<void>('switch_to_sibling', { messageId, siblingId, chatId });
  }

  async getMessageSiblings(messageId: string): Promise<MessageSibling[]> {
    return invoke<MessageSibling[]>('get_message_siblings', { messageId });
  }

  async cancelRun(messageId: string): Promise<{ cancelled: boolean }> {
    return invoke<{ cancelled: boolean }>('cancel_run', { messageId });
  }
}

export const api = ApiService.getInstance();
