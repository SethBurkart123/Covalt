export type BackendChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  toolCalls?: Array<{
    id: string;
    toolName: string;
    toolArgs: Record<string, any>;
    toolResult?: string;
    isCompleted?: boolean;
  }>;
};

class BackendApiService {
  private static instance: BackendApiService;
  private baseUrl: string | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.baseUrl = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL || null;
    }
  }

  static getInstance(): BackendApiService {
    if (!BackendApiService.instance) {
      BackendApiService.instance = new BackendApiService();
    }
    return BackendApiService.instance;
  }

  configureBaseUrl(url: string) {
    this.baseUrl = url;
  }

  async getChat(chatId: string): Promise<{ id: string; messages: BackendChatMessage[] }> {
    // Try backend first if configured
    if (this.baseUrl) {
      try {
        const res = await fetch(`${this.baseUrl}/chats/${encodeURIComponent(chatId)}`);
        if (res.ok) {
          return res.json();
        }
      } catch {
        // fall through to local fallback
      }
    }

    // Local fallback: read from localStorage-based storage
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('chat-storage') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        const chat = parsed?.chats?.[chatId];
        if (chat) {
          return {
            id: chatId,
            messages: (chat.messages || []).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls,
              createdAt: m.createdAt,
            })),
          };
        }
      }
    } catch {}

    return { id: chatId, messages: [] };
  }

  async streamChat(
    messages: BackendChatMessage[],
    modelId: string,
    chatId?: string,
  ): Promise<Response> {
    // If a backend URL exists, attempt to stream from it.
    if (this.baseUrl) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, modelId, chatId, stream: true }),
        });
        if (res.ok && res.body) return res;
      } catch {
        // fallthrough to synthetic stream
      }
    }

    // Try Python backend (PyTauri) for a response, then stream it.
    let pythonReply: string | null = null;
    try {
      // Dynamically import to avoid SSR issues
      const client = await import('../../../src/client/apiClient');
      const last = messages[messages.length - 1];
      if (client && typeof client.greet === 'function') {
        const res = await client.greet({ name: last?.content || 'there' });
        if (res && typeof (res as any).message === 'string') {
          pythonReply = (res as any).message as string;
        }
      }
    } catch {
      // ignore and fall back to synthetic
    }

    // Synthetic SSE stream as a fallback (uses Python reply if available)
    const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueueLine = (line: string) => controller.enqueue(encoder.encode(line));
        const sendEvent = (event: string, data: Record<string, any>) => {
          enqueueLine(`event: ${event}\n`);
          enqueueLine(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Run created
        sendEvent('RunCreated', { session_id: sessionId });

        const reply = (pythonReply ?? `Echo: ${messages[messages.length - 1]?.content || ''}`).trim() || 'Hello!';
        let idx = 0;
        const interval = setInterval(() => {
          if (idx < reply.length) {
            const chunk = reply.slice(idx, idx + 10);
            idx += 10;
            sendEvent('ContentDelta', { content: chunk });
          } else {
            clearInterval(interval);
            sendEvent('RunCompleted', { content: reply });
            controller.close();
          }
        }, 30);
      },
      cancel() {
        // no-op
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }
}

export const backendApiService = BackendApiService.getInstance();
