import { v4 as uuidv4 } from 'uuid';
import { ChatStorageService } from '@/lib/services/chat-storage';
import type { AllChatsData, ChatData } from '@/lib/types/chat';

export class BackendChatStorageService {
  private static instance: BackendChatStorageService;
  private storage = ChatStorageService.getInstance();

  private constructor() {}

  static getInstance(): BackendChatStorageService {
    if (!BackendChatStorageService.instance) {
      BackendChatStorageService.instance = new BackendChatStorageService();
    }
    return BackendChatStorageService.instance;
  }

  async load(): Promise<AllChatsData> {
    try {
      const data = this.storage.load();
      return Promise.resolve(data);
    } catch {
      return Promise.resolve({ chats: {} });
    }
  }

  async createChat(
    title?: string,
    model?: string,
    chatId?: string,
  ): Promise<ChatData> {
    const id = chatId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : uuidv4());
    const now = new Date().toISOString();
    const newChat: ChatData = {
      id,
      title: title?.trim() || 'New Chat',
      messages: [],
      thinkingTime: [],
      model,
      createdAt: now,
      updatedAt: now,
    };

    const data = this.storage.load();
    const next: AllChatsData = {
      ...data,
      chats: {
        ...data.chats,
        [id]: newChat,
      },
    };

    this.storage.saveImmediate(next);
    return newChat;
  }

  async updateChat(id: string, partial: Partial<ChatData>): Promise<ChatData> {
    const data = this.storage.load();
    const existing = data.chats[id];
    if (!existing) {
      throw new Error(`Chat not found: ${id}`);
    }

    const updated: ChatData = {
      ...existing,
      ...partial,
      updatedAt: new Date().toISOString(),
    };

    const next: AllChatsData = {
      ...data,
      chats: {
        ...data.chats,
        [id]: updated,
      },
    };
    this.storage.saveImmediate(next);
    return updated;
  }

  async deleteChat(id: string): Promise<void> {
    const data = this.storage.load();
    if (!data.chats[id]) return;
    const { [id]: _, ...rest } = data.chats;
    const next: AllChatsData = { ...data, chats: rest };
    this.storage.saveImmediate(next);
  }
}

