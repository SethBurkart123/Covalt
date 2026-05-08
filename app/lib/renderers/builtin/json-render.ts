import type { MessageRendererMatch } from "../types";

const JSON_RENDER_PATTERN = /<json-render>([\s\S]*?)<\/json-render>/g;

export function matchJsonRender(content: string): MessageRendererMatch[] {
  const matches: MessageRendererMatch[] = [];
  for (const m of content.matchAll(JSON_RENDER_PATTERN)) {
    if (m.index === undefined) continue;
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      config: { raw: m[1] ?? "" },
    });
  }
  return matches;
}
