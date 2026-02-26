import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatStreamState } from "@/contexts/streaming-context";
import type { StreamResult } from "@/lib/services/stream-processor";
import type {
  Attachment,
  ContentBlock,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";

export interface UseChatInputOptions {
  onThinkTagDetected?: () => void;
  getVisibleModelOptions?: () => Record<string, unknown>;
}

export interface UseChatInputState {
  baseMessages: Message[];
  setBaseMessages: Dispatch<SetStateAction<Message[]>>;
  messageSiblings: Record<string, MessageSibling[]>;
  setMessageSiblings: Dispatch<SetStateAction<Record<string, MessageSibling[]>>>;
  submissionChatId: string | null;
  setSubmissionChatId: Dispatch<SetStateAction<string | null>>;
}

export interface UseChatInputRefs {
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamAbortRef: MutableRefObject<(() => void) | null>;
  selectedModelRef: MutableRefObject<string>;
  activeSubmissionChatIdRef: MutableRefObject<string | null>;
  loadTokenRef: MutableRefObject<number>;
  currentChatIdRef: MutableRefObject<string | null>;
  prevChatIdRef: MutableRefObject<string | null>;
}

export interface UseChatInputContext {
  chatId: string;
  selectedModel: string;
  refreshChats: () => Promise<void>;
  activeToolIds: string[];
  setChatToolIds: (
    toolIds: string[],
    options?: { persistDefaults?: boolean },
  ) => Promise<void>;
  getStreamState: (chatId: string) => ChatStreamState | undefined;
  registerStream: (chatId: string, messageId: string) => void;
  unregisterStream: (chatId: string) => void;
  updateStreamContent: (chatId: string, content: ContentBlock[]) => void;
  onStreamComplete: (callback: (chatId: string) => void) => () => void;
}

export interface UseChatInputEditing {
  editingMessageId: string | null;
  editingDraft: string;
  setEditingDraft: (draft: string) => void;
  editingAttachments: (Attachment | PendingAttachment)[];
  startEditing: (message: Message) => void;
  clearEditing: () => void;
  addAttachment: (file: File) => Promise<void>;
  removeAttachment: (id: string) => void;
}

export type ReloadMessages = (id: string) => Promise<void>;
export type TriggerReload = () => void;
export type TrackModel = (model?: string) => void;
export type PreserveStreamingMessage = (result: StreamResult) => void;
