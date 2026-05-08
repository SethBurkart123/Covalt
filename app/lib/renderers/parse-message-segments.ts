import { listMessageMatchers } from "./registry";
import { registerBuiltinMessageRenderers } from "./builtin";

registerBuiltinMessageRenderers();

export interface MessageSegment {
  kind: "markdown" | "renderer";
  text?: string;
  rendererKey?: string;
  config?: Record<string, unknown>;
}

interface AcceptedMatch {
  key: string;
  start: number;
  end: number;
  config: Record<string, unknown>;
}

export function parseMessageSegments(content: string): MessageSegment[] {
  if (!content) return [];
  const candidates: AcceptedMatch[] = [];
  for (const def of listMessageMatchers()) {
    if (!def.matchMessage) continue;
    for (const m of def.matchMessage(content)) {
      candidates.push({ key: def.key, start: m.start, end: m.end, config: m.config });
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  // Overlap rule: walking left-to-right, the first accepted match wins; any later
  // match whose [start, end) overlaps an accepted span is discarded entirely.
  const accepted: AcceptedMatch[] = [];
  let frontier = 0;
  for (const c of candidates) {
    if (c.start < frontier) continue;
    accepted.push(c);
    frontier = c.end;
  }
  return emitSegments(content, accepted);
}

function emitSegments(content: string, accepted: AcceptedMatch[]): MessageSegment[] {
  const out: MessageSegment[] = [];
  let cursor = 0;
  for (const a of accepted) {
    if (a.start > cursor) {
      const text = content.slice(cursor, a.start);
      if (text.length > 0) out.push({ kind: "markdown", text });
    }
    out.push({ kind: "renderer", rendererKey: a.key, config: a.config });
    cursor = a.end;
  }
  if (cursor < content.length) {
    const text = content.slice(cursor);
    if (text.length > 0) out.push({ kind: "markdown", text });
  }
  return out;
}
