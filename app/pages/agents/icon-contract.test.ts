import { describe, expect, it } from 'vitest';
import { nextAgentIconValue, parseAgentIcon, toEmojiIconValue } from './icon-contract';

describe('icon-contract', () => {
  it('parses emoji, lucide, and image encoded icons', () => {
    expect(parseAgentIcon('emoji:🤖')).toMatchObject({ type: 'emoji', value: '🤖' });
    expect(parseAgentIcon('lucide:Bot')).toMatchObject({ type: 'lucide', value: 'Bot' });
    expect(parseAgentIcon('image:avatar.png')).toMatchObject({ type: 'image', value: 'avatar.png' });
  });

  it('preserves non-emoji icons when emoji input is blank', () => {
    expect(nextAgentIconValue({ existingIcon: 'lucide:Bot', emoji: '' })).toBe('lucide:Bot');
    expect(nextAgentIconValue({ existingIcon: 'image:avatar.png', emoji: '   ' })).toBe('image:avatar.png');
  });

  it('uses emoji value when provided', () => {
    expect(toEmojiIconValue(' 🤖 ')).toBe('emoji:🤖');
    expect(nextAgentIconValue({ existingIcon: 'lucide:Bot', emoji: '✨' })).toBe('emoji:✨');
  });
});
