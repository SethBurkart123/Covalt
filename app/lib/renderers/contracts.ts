import type { ReactNode } from "react";
import type {
  ApprovalRendererProps,
  MessageRendererProps,
  ToolRendererProps,
} from "./types";

export type ToolRenderer = (props: ToolRendererProps) => ReactNode;
export type ApprovalRenderer = (props: ApprovalRendererProps) => ReactNode;
export type MessageRenderer = (props: MessageRendererProps) => ReactNode;
