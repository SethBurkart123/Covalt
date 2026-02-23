export interface OptionChoice {
  value: unknown;
  label: string;
}

export interface ShowWhen {
  option: string;
  values: unknown[];
}

export interface OptionDefinition {
  key: string;
  label: string;
  type: "select" | "slider" | "number" | "boolean";
  default: unknown;
  options?: OptionChoice[];
  min?: number;
  max?: number;
  step?: number;
  showWhen?: ShowWhen;
}

export interface OptionSchema {
  main: OptionDefinition[];
  advanced: OptionDefinition[];
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  displayName: string;
  isDefault?: boolean;
  options?: OptionSchema;
}

export interface ToolInfo {
  id: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
}

export type AttachmentType = "image" | "file" | "audio" | "video";

export interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  mimeType: string;
  size: number;
  data?: string;
}

export interface PendingAttachment extends Attachment {
  data: string;
  previewUrl?: string;
}

export type UploadStatus = "pending" | "uploading" | "uploaded" | "error";

export interface UploadingAttachment extends Omit<Attachment, "data"> {
  uploadStatus: UploadStatus;
  uploadProgress: number;
  uploadError?: string;
  previewUrl?: string;
}

export interface RenderPlan {
  renderer: "code" | "document" | "html" | "frame" | string;
  config: {
    file?: string;
    content?: string;
    language?: string;
    editable?: boolean;
    artifact?: string;
    data?: unknown;
    url?: string;
    port?: number;
  };
}

export interface ToolCallPayload {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  isCompleted?: boolean;
  providerData?: Record<string, unknown>;
  renderPlan?: RenderPlan;
  requiresApproval?: boolean;
  runId?: string;
  toolCallId?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  editableArgs?: string[] | boolean;
  isDelegation?: boolean;
}

export interface ToolApprovalTool {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  editableArgs?: string[] | boolean;
}

export interface ToolApprovalRequiredPayload {
  runId?: string;
  tools: ToolApprovalTool[];
}

export type ContentBlock =
  | { type: "text"; content: string }
  | ({ type: "tool_call" } & ToolCallPayload & { isCompleted: boolean })
  | { type: "reasoning"; content: string; isCompleted: boolean }
  | {
      type: "member_run";
      runId: string;
      memberName: string;
      content: ContentBlock[];
      isCompleted: boolean;
      task?: string;
      hasError?: boolean;
      nodeId?: string;
      nodeType?: string;
      groupByNode?: boolean;
    }
  | { type: "error"; content: string }
  | {
      type: "flow_step";
      nodeId: string;
      nodeType: string;
      nodeName?: string;
      status: "started" | "completed" | "error";
      summary?: string;
      detail?: Record<string, unknown>;
      durationMs?: number;
    };

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
  starred?: boolean;
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
  toggleStarChat: (id: string) => Promise<void>;
  refreshChats: () => Promise<void>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  refreshModels: () => Promise<void>;
  agents: import("@/python/api").AgentInfo[];
  refreshAgents: () => Promise<void>;
}
