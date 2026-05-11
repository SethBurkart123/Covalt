import type { ContentBlock } from "@/lib/types/chat";

type ToolBlock = Extract<ContentBlock, { type: "tool_call" }>;
type MemberRunBlock = Extract<ContentBlock, { type: "member_run" }>;

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function progressContent(block: ToolBlock): ContentBlock[] {
  return (block.progress ?? [])
    .map((entry) => cleanTaskText(entry.detail))
    .filter((content) => content && !isInternalTaskText(content))
    .map((content) => ({ type: "text", content }));
}

function cleanTaskText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\bsession_id:\s*[0-9a-f-]{20,}\b/i, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isInternalTaskText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "executing" || normalized === "subagent session started";
}

export function toolBlockToMemberRun(block: ToolBlock): MemberRunBlock {
  const description = textArg(block.toolArgs, "description") || block.toolName;
  const subagentType = textArg(block.toolArgs, "subagent_type");
  const prompt = textArg(block.toolArgs, "prompt") || description;
  const content = progressContent(block);

  const result = block.toolResult ? cleanTaskText(block.toolResult) : "";
  if (result && !isInternalTaskText(result)) {
    content.push({ type: block.failed ? "error" : "text", content: result });
  }

  return {
    type: "member_run",
    runId: block.id,
    memberName: description,
    content,
    isCompleted: Boolean(block.isCompleted),
    task: prompt,
    hasError: block.failed,
    state: block.isCompleted ? undefined : "running",
    nodeType: subagentType || undefined,
  };
}
