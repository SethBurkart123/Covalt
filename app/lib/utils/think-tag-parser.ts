import type { ContentBlock } from "@/lib/types/chat";
import type { ModelSettingsInfo } from "@/python/api";

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export function shouldParseThinkTags(
  modelUsed: string | undefined,
  modelSettings: ModelSettingsInfo[] | undefined,
): boolean {
  if (!modelUsed || !modelSettings) return false;
  const [provider, modelId] = modelUsed.split(":", 2);
  if (!provider || !modelId) return false;
  const setting = modelSettings.find(
    (m) => m.provider === provider && m.modelId === modelId,
  );
  return setting?.parseThinkTags === true;
}

export function parseThinkTags(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let pos = 0;

  while (pos < content.length) {
    const openIdx = content.indexOf(OPEN_TAG, pos);

    if (openIdx === -1) {
      const text = content.substring(pos);
      if (text) blocks.push({ type: "text", content: text });
      break;
    }

    if (openIdx > pos) {
      blocks.push({ type: "text", content: content.substring(pos, openIdx) });
    }

    const contentStart = openIdx + OPEN_TAG.length;
    const closeIdx = content.indexOf(CLOSE_TAG, contentStart);

    if (closeIdx === -1) {
      const reasoning = content.substring(contentStart);
      if (reasoning) {
        blocks.push({ type: "reasoning", content: reasoning, isCompleted: false });
      }
      break;
    }

    const reasoning = content.substring(contentStart, closeIdx);
    if (reasoning) {
      blocks.push({ type: "reasoning", content: reasoning, isCompleted: true });
    }
    pos = closeIdx + CLOSE_TAG.length;
  }

  return blocks.length > 0 ? blocks : [{ type: "text", content: "" }];
}

export function processMessageContent(
  content: ContentBlock[] | string,
  shouldParse: boolean,
): ContentBlock[] {
  if (!shouldParse) {
    return typeof content === "string" ? [{ type: "text", content }] : content;
  }

  if (typeof content === "string") {
    return parseThinkTags(content);
  }

  const processed: ContentBlock[] = [];
  let currentText = "";

  for (const block of content) {
    if (block.type === "text") {
      currentText += block.content;
    } else {
      if (currentText) {
        processed.push(...parseThinkTags(currentText));
        currentText = "";
      }
      processed.push(block);
    }
  }

  if (currentText) {
    processed.push(...parseThinkTags(currentText));
  }

  return processed;
}