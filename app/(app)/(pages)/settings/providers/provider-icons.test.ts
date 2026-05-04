import { describe, expect, it } from 'vitest';
import { getProviderIcon, OpenAIIcon } from './provider-icons';
import GitHubIcon from './icons/GitHub';

describe('provider-icons', () => {
  it('falls back when key is missing or unknown', () => {
    expect(getProviderIcon()).toBe(OpenAIIcon);
    expect(getProviderIcon(null)).toBe(OpenAIIcon);
    expect(getProviderIcon('totally-unknown-provider')).toBe(OpenAIIcon);
  });

  it('normalizes provider keys before lookup', () => {
    expect(getProviderIcon('GitHub Models')).toBe(GitHubIcon);
    expect(getProviderIcon('github_models')).toBe(GitHubIcon);
  });
});
