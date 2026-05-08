import { registerRenderer, type RendererDefinition } from "@/lib/renderers";
import type { ApprovalRenderer, ToolRenderer } from "@/lib/renderers/contracts";

import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import { CodeArtifact } from "@/components/tool-renderers/code/CodeArtifact";
import { MarkdownArtifact } from "@/components/tool-renderers/markdown/MarkdownArtifact";
import { HtmlArtifact } from "@/components/tool-renderers/html/HtmlArtifact";
import { FrameArtifact } from "@/components/tool-renderers/frame/FrameArtifact";
import { FileEditorArtifact } from "@/components/tool-renderers/editor/FileEditorArtifact";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";
import { TerminalRenderer } from "@/components/tool-renderers/terminal/TerminalRenderer";
import { TerminalApproval } from "@/components/tool-renderers/terminal/TerminalApproval";
import { WebSearchRenderer } from "@/components/tool-renderers/web-search/WebSearchRenderer";
import { TodoListRenderer } from "@/components/tool-renderers/todo-list/TodoListRenderer";
import { FileReadRenderer } from "@/components/tool-renderers/file-read/FileReadRenderer";
import { KeyValueRenderer } from "@/components/tool-renderers/key-value/KeyValueRenderer";
import { FileDiffRenderer } from "@/components/tool-renderers/file-diff/FileDiffRenderer";
import { FileDiffApproval } from "@/components/tool-renderers/file-diff/FileDiffApproval";
import { PatchDiffRenderer } from "@/components/tool-renderers/patch-diff/PatchDiffRenderer";
import { PatchDiffApproval } from "@/components/tool-renderers/patch-diff/PatchDiffApproval";

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
  {
    key: "terminal",
    // matches common shell-exec tool names from various agent SDKs
    toolNamePatterns: [/^(bash|execute|shell|run_command|exec)$/i],
    tool: eager(TerminalRenderer),
    approval: eagerApproval(TerminalApproval),
  },
  {
    key: "web-search",
    toolNamePatterns: [/^(websearch|web_search|search_web|google_search|search)$/i],
    tool: eager(WebSearchRenderer),
  },
  {
    key: "todo-list",
    toolNamePatterns: [/^(todowrite|todo_write|update_todos|todo_list)$/i],
    tool: eager(TodoListRenderer),
  },
  {
    key: "file-read",
    toolNamePatterns: [/^(read|read_file|view|view_file|cat)$/i],
    tool: eager(FileReadRenderer),
  },
  {
    key: "key-value",
    tool: eager(KeyValueRenderer),
  },
  {
    key: "file-diff",
    toolNamePatterns: [/^(edit|str_replace|replace_in_file|update_file|write_file)$/i],
    tool: eager(FileDiffRenderer),
    approval: eagerApproval(FileDiffApproval),
  },
  {
    key: "patch-diff",
    toolNamePatterns: [/^(apply_patch|applypatch|patch)$/i],
    tool: eager(PatchDiffRenderer),
    approval: eagerApproval(PatchDiffApproval),
  },
];

export function registerBuiltinToolRenderers(): void {
  if (registered) return;
  registered = true;
  for (const def of BUILTIN_DEFINITIONS) {
    registerRenderer(def);
  }
}
