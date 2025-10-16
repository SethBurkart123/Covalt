import { AllChatsData } from '@/lib/types/chat';
import { debounce } from 'lodash';

const STORAGE_KEY = 'chat-storage';

export class ChatStorageService {
  private static instance: ChatStorageService;
  private saveDebounced: ReturnType<typeof debounce>;

  private constructor() {
    this.saveDebounced = debounce(this.saveToStorage.bind(this), 500);
  }

  static getInstance(): ChatStorageService {
    if (!ChatStorageService.instance) {
      ChatStorageService.instance = new ChatStorageService();
    }
    return ChatStorageService.instance;
  }

  load(): AllChatsData {
    if (typeof window === 'undefined') {
      return { chats: {} };
    }

    try {
      const rawData = localStorage.getItem(STORAGE_KEY);
      if (rawData) {
        const parsedData = JSON.parse(rawData);
        if (parsedData && typeof parsedData.chats === 'object') {
          return parsedData;
        }
      }
    } catch (e) {
      console.error('Failed to load chat data from storage:', e);
    }

    return { chats: {} };
  }

  save(data: AllChatsData): void {
    this.saveDebounced(data);
  }

  saveImmediate(data: AllChatsData): void {
    this.saveDebounced.cancel();
    this.saveToStorage(data);
  }

  private saveToStorage(data: AllChatsData): void {
    if (typeof window === 'undefined') return;

    try {
      const cleanedData = this.pruneEmptyChats(data);
      
      if (Object.keys(cleanedData.chats).length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedData));
      }
    } catch (e) {
      console.error('Failed to save chat data to storage:', e);
    }
  }

  private pruneEmptyChats(data: AllChatsData): AllChatsData {
    const chatIds = Object.keys(data.chats);
    if (chatIds.length <= 1) return data;

    const cleanedChats = { ...data.chats };
    const idsToRemove: string[] = [];

    chatIds.forEach((id, index) => {
      const chat = data.chats[id];
      if (chat.messages.length === 0) {
        const title = chat.title.trim();
        if (!title || title === `Chat #${index + 1}` || title === 'New Chat') {
          idsToRemove.push(id);
        }
      }
    });

    idsToRemove.forEach(id => delete cleanedChats[id]);
    return { ...data, chats: cleanedChats };
  }

  cancelPendingSaves(): void {
    this.saveDebounced.cancel();
  }
}