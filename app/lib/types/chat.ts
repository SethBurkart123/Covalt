import type { Message } from 'ai';

export interface ThinkingTime {
  index: number;
  time: number;
}

export interface ChatData {
  id?: string; // Optional for backward compatibility
  title: string;
  messages: Message[];
  thinkingTime: ThinkingTime[];
  model?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AllChatsData {
  chats: {
    [chatId: string]: ChatData;
  };
}

export interface ChatContextType {
  chatId: string;
  visualChatId: string;
  chatTitle: string;
  chatIds: string[];
  chatsData: AllChatsData['chats'];
  startNewChat: () => void;
  createNewChat: (chatId?: string) => Promise<string>;
  finalizeNewChat: (chatId: string, messages: Message[]) => Promise<void>;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, newTitle: string) => Promise<void>;
  updateChatMessages: (id: string, messages: Message[]) => Promise<void>;
  addThinkingTime: (id: string, messageIndex: number, thinkingTimeMs: number) => Promise<void>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: string[];
}
