import type { MessageRenderer } from "../contracts";
import type { MessageRendererMatch } from "../types";

const SYSTEM_REMINDER_PATTERN = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;

export function matchSystemReminder(content: string): MessageRendererMatch[] {
  const matches: MessageRendererMatch[] = [];
  for (const m of content.matchAll(SYSTEM_REMINDER_PATTERN)) {
    if (m.index === undefined) continue;
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      config: { body: m[1] ?? "" },
    });
  }
  return matches;
}

const SystemReminderRenderer: MessageRenderer = () => null;

export default SystemReminderRenderer;
