import type { ToolCallPayload } from "@/lib/types/chat";
import type { RendererRole } from "@nodes/_manifest";

export type { RendererRole };

export type RendererKey = string;

export interface RenderPlan {
  renderer: string;
  config?: Record<string, unknown>;
}

export interface ToolRendererProps {
  toolCall: ToolCallPayload;
  config?: Record<string, unknown>;
  chatId?: string;
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

export interface ApprovalRequest {
  toolCallId: string;
  runId: string;
  kind: "tool_approval" | "user_input";
  toolUseIds?: string[];
  toolName?: string;
  riskLevel?: "low" | "medium" | "high" | "unknown";
  summary?: string;
  options: ApprovalOption[];
  questions: ApprovalQuestion[];
  editable: ApprovalEditable[];
  renderer?: string;
  config?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ApprovalAnswer {
  index: number;
  answer: string;
}

export interface ApprovalOutcome {
  selectedOption: string;
  answers?: ApprovalAnswer[];
  editedArgs?: Record<string, unknown>;
  cancelled?: boolean;
}

export interface ApprovalResolveResult {
  matched: boolean;
}

export interface ApprovalRendererProps {
  request: ApprovalRequest;
  isPending: boolean;
  onResolve: (outcome: ApprovalOutcome) => Promise<void | ApprovalResolveResult>;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  mode?: import("@/components/ui/collapsible").CollapsibleMode;
}

export interface MessageRendererProps {
  config: Record<string, unknown>;
  chatId?: string;
}

export interface MessageRendererMatch {
  start: number;
  end: number;
  config: Record<string, unknown>;
}
