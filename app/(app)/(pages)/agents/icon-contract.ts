export type AgentIconType = 'emoji' | 'lucide' | 'image' | null;

export interface ParsedAgentIcon {
  type: AgentIconType;
  value: string;
  raw: string | null;
}

export function parseAgentIcon(icon: string | null | undefined): ParsedAgentIcon {
  if (!icon) return { type: null, value: '', raw: null };

  if (icon.startsWith('emoji:')) {
    return { type: 'emoji', value: icon.slice(6), raw: icon };
  }
  if (icon.startsWith('lucide:')) {
    return { type: 'lucide', value: icon.slice(7), raw: icon };
  }
  if (icon.startsWith('image:')) {
    return { type: 'image', value: icon.slice(6), raw: icon };
  }

  return { type: 'emoji', value: icon, raw: icon };
}

export function toEmojiIconValue(emoji: string): string | undefined {
  const normalized = emoji.trim();
  return normalized ? `emoji:${normalized}` : undefined;
}

export function nextAgentIconValue(options: {
  existingIcon: string | null | undefined;
  emoji: string;
}): string | undefined {
  const nextEmoji = toEmojiIconValue(options.emoji);
  if (nextEmoji) {
    return nextEmoji;
  }

  const existing = parseAgentIcon(options.existingIcon);
  if (existing.type === 'lucide' || existing.type === 'image') {
    return existing.raw || undefined;
  }

  return undefined;
}
