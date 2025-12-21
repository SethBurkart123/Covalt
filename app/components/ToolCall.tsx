"use client";

import { ToolCallRouter } from "@/components/ToolCallRouter";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

export default function ToolCall(props: ToolCallRendererProps) {
  return <ToolCallRouter {...props} />;
}
