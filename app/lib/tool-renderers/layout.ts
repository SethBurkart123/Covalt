import { getToolRenderer } from "@/lib/renderers";
import type { ContentBlock } from "@/lib/types/chat";

function getToolDefinition(block: ContentBlock) {
  if (block.type !== "tool_call") return undefined;
  return getToolRenderer(block.renderPlan?.renderer, block.toolName);
}

export function isStandaloneToolBlock(block: ContentBlock): boolean {
  return getToolDefinition(block)?.layout === "standalone";
}

export function isMemberRunToolBlock(block: ContentBlock): boolean {
  return getToolDefinition(block)?.surface === "member_run";
}

export function shouldSkipConsecutiveToolBlock(
  blocks: ContentBlock[],
  index: number,
): boolean {
  const block = blocks[index];
  const definition = getToolDefinition(block);
  if (!definition?.collapseConsecutive) return false;
  if (definition.layout !== "standalone") return false;

  for (let i = index + 1; i < blocks.length; i++) {
    const next = blocks[i];
    if (next.type === "text" && !next.content.trim()) continue;
    const nextDefinition = getToolDefinition(next);
    return (
      nextDefinition?.collapseConsecutive === true
      && nextDefinition.layout === "standalone"
      && nextDefinition.key === definition.key
    );
  }
  return false;
}
