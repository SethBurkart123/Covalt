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
  toolsetId?: string | null;
  toolsetName?: string | null;
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
  renderer: "code" | "document" | "html" | "frame" | "editor" | string;
  config: {
    file?: string;
    content?: string;
    language?: string;
    editable?: boolean;
    artifact?: string;
    data?: unknown;
    url?: string;
    port?: number;
    path?: string;
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
  failed?: boolean;
  requiresApproval?: boolean;
  runId?: string;
  requestId?: string;
  toolCallId?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  editableArgs?: string[] | boolean;
  isDelegation?: boolean;
  riskLevel?: "low" | "medium" | "high" | "unknown";
  summary?: string;
  options?: ApprovalOption[];
  questions?: ApprovalQuestion[];
  editable?: ApprovalEditable[];
}

export interface ToolApprovalTool {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  editableArgs?: string[] | boolean;
}

export interface ApprovalOption {
  value: string;
  label: string;
  role: "allow_once" | "allow_session" | "allow_always" | "deny" | "abort" | "custom";
  style?: "default" | "primary" | "destructive";
  requiresInput?: boolean;
}

export interface ApprovalQuestion {
  index: number;
  topic: string;
  question: string;
  options?: string[];
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface ApprovalEditable {
  path: string[];
  schema: Record<string, unknown>;
  label?: string;
}

export interface ApprovalAnswer {
  index: number;
  answer: string;
}

export interface ApprovalRequiredPayload {
  runId?: string;
  requestId: string;
  kind: "tool_approval" | "user_input";
  toolUseIds?: string[];
  toolName?: string;
  riskLevel?: "low" | "medium" | "high" | "unknown";
  summary?: string;
  options?: ApprovalOption[];
  questions?: ApprovalQuestion[];
  editable?: ApprovalEditable[];
  renderer?: string;
  config?: Record<string, unknown>;
  timeoutMs?: number;
  tools: ToolApprovalTool[];
}

export interface ApprovalResolvedTool {
  id: string;
  toolName?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  toolArgs?: Record<string, unknown>;
}

export interface ApprovalResolvedPayload {
  runId?: string;
  requestId: string;
  selectedOption: string;
  answers?: ApprovalAnswer[];
  editedArgs?: Record<string, unknown> | null;
  cancelled?: boolean;
  tools: ApprovalResolvedTool[];
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
      cancelled?: boolean;
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
  chatId: string | null;
  chatTitle: string;
  chatIds: string[];
  chatsLoaded: boolean;
  chatsData: AllChatsData["chats"];
  startNewChat: () => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, newTitle: string) => Promise<void>;
  toggleStarChat: (id: string) => Promise<void>;
  refreshChats: () => Promise<void>;
  loadMoreChats: () => Promise<void>;
  hasMoreChats: boolean;
  isLoadingMoreChats: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  refreshModels: () => Promise<void>;
  agents: import("@/python/api").AgentInfo[];
  refreshAgents: () => Promise<void>;
}
