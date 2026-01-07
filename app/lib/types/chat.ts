export interface ModelInfo {
  provider: string;
  modelId: string;
  displayName: string;
  isDefault?: boolean;
}

export interface ToolInfo {
  id: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
}

// Attachment types
export type AttachmentType = "image" | "file" | "audio" | "video";

export interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  mimeType: string;
  size: number;
  data?: string; // base64 encoded data (optional, used for local preview before backend reload)
}

// For pending attachments (before upload) - includes base64 data
export interface PendingAttachment extends Attachment {
  data: string; // base64 encoded file content
  previewUrl?: string; // blob URL for local preview (images only)
}

// Upload status tracking
export type UploadStatus = "pending" | "uploading" | "uploaded" | "error";

// For attachments that are being uploaded
export interface UploadingAttachment extends Omit<Attachment, "data"> {
  uploadStatus: UploadStatus;
  uploadProgress: number; // 0-100
  uploadError?: string;
  previewUrl?: string; // blob URL for local preview (images only)
}

export type ContentBlock =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      id: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      toolResult?: string;
      isCompleted: boolean;
      renderer?: string;
      requiresApproval?: boolean;
      runId?: string;
      toolCallId?: string;
      approvalStatus?: "pending" | "approved" | "denied" | "timeout";
      editableArgs?: string[] | boolean;
    }
  | { type: "reasoning"; content: string; isCompleted: boolean }
  | { type: "error"; content: string };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[] | string;
  createdAt?: string;
  parentMessageId?: string | null;
  isComplete: boolean;
  sequence: number;
  modelUsed?: string;
  attachments?: Attachment[];
}

export interface MessageSibling {
  id: string;
  sequence: number;
  isActive: boolean;
}

export interface AgentConfig {
  provider: string;
  modelId: string;
  toolIds: string[];
  instructions?: string[];
  name?: string;
  description?: string;
}

export interface ChatData {
  id?: string;
  title: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  agentConfig?: AgentConfig;
}

export interface AllChatsData {
  chats: {
    [chatId: string]: ChatData;
  };
}

export interface ChatContextType {
  chatId: string;
  chatTitle: string;
  chatIds: string[];
  chatsData: AllChatsData["chats"];
  startNewChat: () => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, newTitle: string) => Promise<void>;
  refreshChats: () => Promise<void>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  refreshModels: () => Promise<void>;
}
