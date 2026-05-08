import { registerRenderer, type RendererDefinition } from "@/lib/renderers";
import type { ApprovalRenderer, ToolRenderer } from "@/lib/renderers/contracts";

import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import { CodeArtifact } from "@/components/tool-renderers/code/CodeArtifact";
import { MarkdownArtifact } from "@/components/tool-renderers/markdown/MarkdownArtifact";
import { HtmlArtifact } from "@/components/tool-renderers/html/HtmlArtifact";
import { FrameArtifact } from "@/components/tool-renderers/frame/FrameArtifact";
import { FileEditorArtifact } from "@/components/tool-renderers/editor/FileEditorArtifact";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";

let registered = false;

const eager = (component: unknown): (() => Promise<{ default: ToolRenderer }>) =>
  async () => ({ default: component as ToolRenderer });

const eagerApproval = (
  component: unknown,
): (() => Promise<{ default: ApprovalRenderer }>) =>
  async () => ({ default: component as ApprovalRenderer });

const BUILTIN_DEFINITIONS: RendererDefinition[] = [
  {
    key: "default",
    tool: eager(DefaultToolCall),
    approval: eagerApproval(DefaultApproval),
  },
  { key: "code", tool: eager(CodeArtifact) },
  { key: "document", aliases: ["markdown"], tool: eager(MarkdownArtifact) },
  { key: "html", tool: eager(HtmlArtifact) },
  { key: "frame", tool: eager(FrameArtifact) },
  { key: "editor", tool: eager(FileEditorArtifact) },
];

export function registerBuiltinToolRenderers(): void {
  if (registered) return;
  registered = true;
  for (const def of BUILTIN_DEFINITIONS) {
    registerRenderer(def);
  }
}
