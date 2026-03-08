import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ProviderOauthActionButtonProps {
  authUrl?: string;
  oauthConnected: boolean;
  isAuthenticating: boolean;
  isRevoking: boolean;
  providerName: string;
  onStart: () => Promise<void> | void;
  onRevoke: () => Promise<void> | void;
  onOpenLink: (url: string) => void;
  idleLabel?: string;
  authenticatingLabel?: string;
  connectedLabel?: string;
  revokingLabel?: string;
  variant?: 'secondary' | 'outline';
}

export function ProviderOauthActionButton({
  authUrl,
  oauthConnected,
  isAuthenticating,
  isRevoking,
  providerName,
  onStart,
  onRevoke,
  onOpenLink,
  idleLabel = 'Sign in',
  authenticatingLabel = 'Waiting...',
  connectedLabel = 'Sign out',
  revokingLabel = 'Signing out...',
  variant = 'secondary',
}: ProviderOauthActionButtonProps) {
  if (isRevoking) {
    return (
      <Button variant={variant} size="sm" disabled>
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        {revokingLabel}
      </Button>
    );
  }

  if (oauthConnected) {
    return (
      <Button variant={variant} size="sm" onClick={onRevoke}>
        {connectedLabel}
      </Button>
    );
  }

  if (authUrl) {
    return (
      <Button variant={variant} size="sm" onClick={() => onOpenLink(authUrl)}>
        Open link
      </Button>
    );
  }

  return (
    <Button variant={variant} size="sm" onClick={onStart} disabled={isAuthenticating}>
      {isAuthenticating ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {authenticatingLabel}
        </>
      ) : (
        <>
          {idleLabel}
          <span className="sr-only"> to {providerName}</span>
        </>
      )}
    </Button>
  );
}
