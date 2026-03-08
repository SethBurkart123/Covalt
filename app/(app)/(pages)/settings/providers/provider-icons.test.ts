import { describe, expect, it } from 'vitest';
import { getProviderIcon, OpenAIIcon } from './provider-icons';
import GitHubIcon from './icons/GitHub';

describe('provider-icons', () => {
  it('returns OpenAI icon when key is missing or unknown', () => {
    expect(getProviderIcon()).toBe(OpenAIIcon);
    expect(getProviderIcon(null)).toBe(OpenAIIcon);
    expect(getProviderIcon('totally-unknown-provider')).toBe(OpenAIIcon);
  });

  it('normalizes provider keys before lookup', () => {
    expect(getProviderIcon('GitHub Models')).toBe(GitHubIcon);
    expect(getProviderIcon('github_models')).toBe(GitHubIcon);
  });

  it('returns stable image-backed icon components for mapped providers', () => {
    const anthropicIcon = getProviderIcon('Anthropic');
    const anthropicIconAgain = getProviderIcon('anthropic');

    expect(anthropicIcon).toBe(anthropicIconAgain);
    expect(anthropicIcon).not.toBe(OpenAIIcon);
  });
});
