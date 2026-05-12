import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RunPhase, RunState } from "@/contexts/streaming-context";
import type { RunEvent } from "@/lib/services/chat-run-machine";
import type { StreamResult } from "@/lib/services/stream-processor";
import type {
  Attachment,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";

export interface UseChatInputOptions {
  onThinkTagDetected?: () => void;
  getVisibleModelOptions?: () => Record<string, unknown>;
  getVisibleVariables?: () => Record<string, unknown>;
}

export interface UseChatInputState {
  baseMessages: Message[];
  setBaseMessages: Dispatch<SetStateAction<Message[]>>;
  messageSiblings: Record<string, MessageSibling[]>;
  setMessageSiblings: Dispatch<SetStateAction<Record<string, MessageSibling[]>>>;
}

export interface UseChatInputRefs {
  streamAbortRef: MutableRefObject<(() => void) | null>;
  selectedModelRef: MutableRefObject<string>;
  loadTokenRef: MutableRefObject<number>;
  currentChatIdRef: MutableRefObject<string | null>;
  prevChatIdRef: MutableRefObject<string | null>;
}

export interface UseChatInputContext {
  chatId: string | null;
  selectedModel: string;
  refreshChats: () => Promise<void>;
  activeToolIds: readonly string[];
  setChatToolIds: (
    toolIds: readonly string[],
    options?: { persistDefaults?: boolean },
  ) => Promise<void>;
  getRunState: (chatId: string) => RunState | undefined;
  startRun: (chatId: string, options?: { subscribe?: boolean }) => void;
  completeRun: (chatId: string) => void;
  onPhaseChange: (callback: (chatId: string, phase: RunPhase, prevPhase: RunPhase) => void) => () => void;
  dispatchRunEvent: (chatId: string, event: RunEvent) => void;
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
