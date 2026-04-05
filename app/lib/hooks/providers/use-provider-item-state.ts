import { useRef, useState } from 'react';
import type { ProviderDefinition } from '@/lib/types/provider-catalog';
import type { OAuthState } from './types';

interface UseProviderItemStateParams {
  def: ProviderDefinition;
  isConnected: boolean;
  oauthStatus?: OAuthState;
  oauthIsAuthenticating?: boolean;
  oauthIsRevoking?: boolean;
  oauthIsSubmitting?: boolean;
}

const extractDeviceCode = (instructions?: string): string | null => {
  if (!instructions) return null;
  const labeledMatch = instructions.match(/code:\s*([A-Za-z0-9-]+)/i);
  if (labeledMatch?.[1]) return labeledMatch[1];
  const dashedMatch = instructions.match(/[A-Za-z0-9]{3,}-[A-Za-z0-9]{3,}/);
  if (dashedMatch) return dashedMatch[0];
  const plainMatch = instructions.match(/[A-Za-z0-9]{6,}/);
  return plainMatch ? plainMatch[0] : null;
};

const formatDeviceCode = (code: string): string => {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!normalized) return code.toUpperCase();
  if (normalized.length % 2 === 0 && normalized.length >= 6) {
    const midpoint = normalized.length / 2;
    return `${normalized.slice(0, midpoint)}-${normalized.slice(midpoint)}`;
  }
  if (normalized.length === 6) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  return normalized;
};

export function useProviderItemState({
  def,
  isConnected,
  oauthStatus,
  oauthIsAuthenticating,
  oauthIsRevoking,
  oauthIsSubmitting,
}: UseProviderItemStateParams) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const isOauth = def.authType === 'oauth';
  const oauthConnected = isOauth
    ? (oauthStatus ? oauthStatus.status === 'authenticated' : isConnected)
    : isConnected;
  const oauthError = oauthStatus?.status === 'error' ? oauthStatus.error : undefined;
  const isOauthAuthenticating = Boolean(oauthIsAuthenticating);
  const isOauthRevoking = Boolean(oauthIsRevoking);
  const isOauthSubmitting = Boolean(oauthIsSubmitting);
  const showOauthConnected = oauthConnected && !isOauthRevoking;
  const oauthVariant = def.oauth?.variant ?? 'panel';
  const isCompactOauth = isOauth && oauthVariant === 'compact';
  const isInlineCodeOauth = isOauth && oauthVariant === 'inline-code';
  const isDeviceOauth = isOauth && oauthVariant === 'device';
  const deviceCode = isDeviceOauth ? extractDeviceCode(oauthStatus?.instructions) : null;
  const formattedDeviceCode = deviceCode ? formatDeviceCode(deviceCode) : null;

  const prevAuthUrlRef = useRef<string | undefined>(undefined);
  const authUrl = oauthStatus?.authUrl;
  if (isDeviceOauth && authUrl && authUrl !== prevAuthUrlRef.current && !oauthConnected) {
    setIsOpen(true);
  }
  prevAuthUrlRef.current = authUrl;

  const handleCopyCode = async () => {
    if (!deviceCode || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(deviceCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1500);
    } catch {
      setCopiedCode(false);
    }
  };

  return {
    isOpen,
    setIsOpen,
    copiedCode,
    isOauth,
    oauthConnected,
    oauthError,
    isOauthAuthenticating,
    isOauthRevoking,
    isOauthSubmitting,
    showOauthConnected,
    oauthVariant,
    isCompactOauth,
    isInlineCodeOauth,
    isDeviceOauth,
    deviceCode,
    formattedDeviceCode,
    handleCopyCode,
  };
}
