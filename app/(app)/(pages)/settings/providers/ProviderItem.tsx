"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ChevronDown, Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';

interface ProviderItemProps {
  def: ProviderDefinition;
  config: ProviderConfig;
  isConnected: boolean;
  saving: boolean;
  saved: boolean;
  connectionStatus: 'idle' | 'testing' | 'success' | 'error';
  connectionError?: string;
  oauthStatus?: {
    status: 'none' | 'pending' | 'authenticated' | 'error';
    authUrl?: string;
    instructions?: string;
    error?: string;
  };
  oauthCode?: string;
  oauthEnterpriseDomain?: string;
  oauthIsAuthenticating?: boolean;
  oauthIsRevoking?: boolean;
  oauthIsSubmitting?: boolean;
  onOauthCodeChange?: (value: string) => void;
  onOauthEnterpriseDomainChange?: (value: string) => void;
  onOauthStart?: () => void;
  onOauthSubmitCode?: () => void;
  onOauthRevoke?: () => void;
  onOauthOpenLink?: (url: string) => void;
  onChange: (field: keyof ProviderConfig, value: string | boolean) => void;
  onSave: () => Promise<void> | void;
  onTestConnection: () => void;
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

export default function ProviderItem({ 
  def, 
  config, 
  isConnected, 
  saving, 
  saved, 
  connectionStatus,
  connectionError,
  oauthStatus,
  oauthCode,
  oauthEnterpriseDomain,
  oauthIsAuthenticating,
  oauthIsRevoking,
  oauthIsSubmitting,
  onOauthCodeChange,
  onOauthEnterpriseDomainChange,
  onOauthStart,
  onOauthSubmitCode,
  onOauthRevoke,
  onOauthOpenLink,
  onChange, 
  onSave,
  onTestConnection
}: ProviderItemProps) {
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

  useEffect(() => {
    if (isDeviceOauth && oauthStatus?.authUrl && !oauthConnected && !isOpen) {
      setIsOpen(true);
    }
  }, [isDeviceOauth, oauthStatus?.authUrl, oauthConnected, isOpen]);

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

  if (isCompactOauth) {
    const authUrl = oauthStatus?.authUrl;
    return (
      <Card className="overflow-hidden border-border/70 py-2 gap-0">
        <div className="w-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-left flex-1 min-w-0">
            <div className="rounded-md flex items-center justify-center">
              <def.icon />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium leading-none flex items-center gap-2">
                {def.name}
                {isOauth && showOauthConnected && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                    <CheckCircle size={14} />
                    Connected
                  </span>
                )}
                {isOauth && oauthStatus?.status === 'pending' && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Pending
                  </span>
                )}
                {isOauth && oauthStatus?.status === 'error' && (
                  <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                    <XCircle size={14} />
                    Failed
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">{def.description}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOauthRevoking ? (
              <Button
                variant="secondary"
                size="sm"
                disabled
              >
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Signing out...
              </Button>
            ) : oauthConnected ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOauthRevoke}
              >
                Sign out
              </Button>
            ) : authUrl ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (onOauthOpenLink) {
                    onOauthOpenLink(authUrl);
                    return;
                  }
                  window.open(authUrl, '_blank');
                }}
              >
                Open link
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOauthStart}
                disabled={isOauthAuthenticating}
              >
                {isOauthAuthenticating ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Waiting...
                  </>
                ) : (
                  <>
                    Sign in
                    <span className="sr-only"> to {def.name}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        {oauthError && (
          <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-500">
            {oauthError}
          </div>
        )}
      </Card>
    );
  }

  if (isInlineCodeOauth) {
    const authUrl = oauthStatus?.authUrl;
    const showCodeInput = Boolean(authUrl) && !oauthConnected;
    return (
      <Card className="overflow-hidden border-border/70 py-2 gap-0">
        <div className="w-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-left flex-1 min-w-0">
            <div className="rounded-md flex items-center justify-center">
              <def.icon />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium leading-none flex items-center gap-2">
                {def.name}
                {showOauthConnected && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                    <CheckCircle size={14} />
                    Connected
                  </span>
                )}
                {oauthStatus?.status === 'pending' && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Pending
                  </span>
                )}
                {oauthStatus?.status === 'error' && (
                  <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                    <XCircle size={14} />
                    Failed
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">{def.description}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOauthRevoking ? (
              <Button
                variant="secondary"
                size="sm"
                disabled
              >
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Signing out...
              </Button>
            ) : oauthConnected ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOauthRevoke}
              >
                Sign out
              </Button>
            ) : authUrl ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (onOauthOpenLink) {
                    onOauthOpenLink(authUrl);
                    return;
                  }
                  window.open(authUrl, '_blank');
                }}
              >
                Open link
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOauthStart}
                disabled={isOauthAuthenticating}
              >
                {isOauthAuthenticating ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Waiting...
                  </>
                ) : (
                  <>
                    Sign in
                    <span className="sr-only"> to {def.name}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        {showCodeInput && (
          <div className="px-4 pt-2 pb-3 mt-2 border-t border-border/60">
            <div className="flex items-center gap-2">
              <Input
                id={`${def.key}-oauth-code`}
                type="text"
                placeholder="Paste authorization code"
                value={oauthCode || ''}
                onChange={(e) => onOauthCodeChange?.(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onOauthSubmitCode}
                disabled={!oauthCode || isOauthSubmitting}
              >
                {isOauthSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit'
                )}
              </Button>
            </div>
          </div>
        )}
        {oauthError && (
          <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-500">
            {oauthError}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/70 py-2 gap-0">
      <button
        className="w-full px-4 flex items-center justify-between transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3 text-left flex-1 min-w-0">
          <div className="rounded-md flex items-center justify-center">
            <def.icon />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium leading-none flex items-center gap-2">
              {def.name}
              {!isOauth && connectionStatus === 'testing' && (
                <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
              )}
              {!isOauth && connectionStatus === 'success' && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle size={14} />
                  Connected
                </span>
              )}
              {!isOauth && connectionStatus === 'error' && (
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                  <XCircle size={14} />
                  Failed
                </span>
              )}
              {!isOauth && connectionStatus === 'idle' && isConnected && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle size={14} />
                  Connected
                </span>
              )}
              {isOauth && showOauthConnected && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle size={14} />
                  Connected
                </span>
              )}
              {isOauth && oauthStatus?.status === 'pending' && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Pending
                </span>
              )}
              {isOauth && oauthStatus?.status === 'error' && (
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                  <XCircle size={14} />
                  Failed
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{def.description}</div>
          </div>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 270, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="px-2 border-t border-border/60 pt-2 space-y-2 mt-2">
              {!isOauth && def.fields.map((field) => (
                <div className="space-y-2" key={`${def.key}-${field.id}`}>
                  <Label htmlFor={`${def.key}-${field.id}`}>{field.label}</Label>
                  <Input
                    id={`${def.key}-${field.id}`}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={(config[field.id] as string) || ''}
                    onChange={(e) => onChange(field.id, e.target.value)}
                  />
                </div>
              ))}

              {isOauth && def.oauth?.enterpriseDomain && (
                <div className="space-y-2">
                  <Label htmlFor={`${def.key}-enterprise-domain`}>Enterprise domain (optional)</Label>
                  <Input
                    id={`${def.key}-enterprise-domain`}
                    type="text"
                    placeholder="company.ghe.com"
                    value={oauthEnterpriseDomain || ''}
                    onChange={(e) => onOauthEnterpriseDomainChange?.(e.target.value)}
                  />
                </div>
              )}

              {isOauth && oauthStatus?.authUrl && (!isDeviceOauth || !oauthConnected) && (
                isDeviceOauth ? (
                  <div className="rounded-md border border-border/60 px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-foreground">Verification code</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyCode}
                        disabled={!deviceCode}
                      >
                        {copiedCode ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-foreground font-mono tracking-[0.35em]">
                      {formattedDeviceCode || '--- ---'}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Sign-in link</div>
                    <div className="break-all mt-1">{oauthStatus.authUrl}</div>
                    {oauthStatus.instructions && (
                      <div className="mt-2">{oauthStatus.instructions}</div>
                    )}
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!oauthStatus.authUrl) return;
                          if (onOauthOpenLink) {
                            onOauthOpenLink(oauthStatus.authUrl);
                            return;
                          }
                          window.open(oauthStatus.authUrl, '_blank');
                        }}
                      >
                        Open link
                      </Button>
                    </div>
                  </div>
                )
              )}

              {isOauth && !isDeviceOauth && (
                <div className="space-y-2">
                  <Label htmlFor={`${def.key}-oauth-code`}>Authorization code</Label>
                  <Input
                    id={`${def.key}-oauth-code`}
                    type="text"
                    placeholder="Paste the authorization code or redirect URL"
                    value={oauthCode || ''}
                    onChange={(e) => onOauthCodeChange?.(e.target.value)}
                  />
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {!isOauth && connectionError && connectionStatus === 'error' && (
                  <div className="text-xs text-red-600 dark:text-red-500 px-1">
                    {connectionError}
                  </div>
                )}
                {isOauth && oauthError && (
                  <div className="text-xs text-red-600 dark:text-red-500 px-1">
                    {oauthError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  {!isOauth && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onTestConnection}
                        disabled={connectionStatus === 'testing'}
                      >
                        {connectionStatus === 'testing' ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </Button>
                      
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={onSave} 
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
                      </Button>
                    </>
                  )}
                  {isOauth && (
                    <>
                      {!isDeviceOauth && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onOauthSubmitCode}
                          disabled={!oauthCode || isOauthSubmitting}
                        >
                          {isOauthSubmitting ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Submitting...
                            </>
                          ) : (
                            'Submit Code'
                          )}
                        </Button>
                      )}
                      {isOauthRevoking ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled
                        >
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {isDeviceOauth ? 'Signing out...' : 'Revoking...'}
                        </Button>
                      ) : isDeviceOauth ? (
                        oauthConnected ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onOauthRevoke}
                          >
                            Sign out
                          </Button>
                        ) : oauthStatus?.authUrl ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (!oauthStatus.authUrl) return;
                              if (onOauthOpenLink) {
                                onOauthOpenLink(oauthStatus.authUrl);
                                return;
                              }
                              window.open(oauthStatus.authUrl, '_blank');
                            }}
                          >
                            Open link
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onOauthStart}
                            disabled={isOauthAuthenticating}
                          >
                            {isOauthAuthenticating ? (
                              <>
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                Waiting...
                              </>
                            ) : (
                              <>
                                Sign in
                                <span className="sr-only"> to {def.name}</span>
                              </>
                            )}
                          </Button>
                        )
                      ) : (!oauthConnected ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={onOauthStart}
                          disabled={isOauthAuthenticating}
                        >
                          {isOauthAuthenticating ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Waiting...
                            </>
                          ) : (
                            'Start Sign-in'
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={onOauthRevoke}
                        >
                          Revoke
                        </Button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
