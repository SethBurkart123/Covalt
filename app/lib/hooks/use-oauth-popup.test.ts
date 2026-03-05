import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { openOauthPopup } from '@/lib/hooks/use-oauth-popup';

describe('openOauthPopup', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    const open = vi.fn();
    (globalThis as { window: unknown }).window = {
      screenX: 100,
      screenY: 200,
      outerWidth: 1400,
      outerHeight: 1000,
      open,
    };
  });

  afterEach(() => {
    (globalThis as { window: unknown }).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('opens centered authentication popup with standard dimensions', () => {
    const mockedWindow = window as unknown as { open: ReturnType<typeof vi.fn> };

    openOauthPopup('https://auth.example.com');

    expect(mockedWindow.open).toHaveBeenCalledTimes(1);
    expect(mockedWindow.open).toHaveBeenCalledWith(
      'https://auth.example.com',
      'Authenticate',
      'width=600,height=800,left=500,top=300',
    );
  });
});
