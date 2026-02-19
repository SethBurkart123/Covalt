"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ChevronDown, Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { ProviderConfig, ProviderDefinition } from './ProviderRegistry';

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
  onOauthCodeChange?: (value: string) => void;
  onOauthEnterpriseDomainChange?: (value: string) => void;
  onOauthStart?: () => void;
  onOauthSubmitCode?: () => void;
  onOauthRevoke?: () => void;
  onChange: (field: keyof ProviderConfig, value: string | boolean) => void;
  onSave: () => Promise<void> | void;
  onTestConnection: () => void;
}

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
  onOauthCodeChange,
  onOauthEnterpriseDomainChange,
  onOauthStart,
  onOauthSubmitCode,
  onOauthRevoke,
  onChange, 
  onSave,
  onTestConnection
}: ProviderItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isOauth = def.authType === 'oauth';
  const oauthConnected = oauthStatus?.status === 'authenticated' || isConnected;
  const oauthError = oauthStatus?.status === 'error' ? oauthStatus.error : undefined;

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
              {isOauth && oauthConnected && (
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
                  {field.type === 'textarea' ? (
                    <textarea
                      id={`${def.key}-${field.id}`}
                      placeholder={field.placeholder}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      rows={6}
                      value={(config[field.id] as string) || ''}
                      onChange={(e) => onChange(field.id, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={`${def.key}-${field.id}`}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={(config[field.id] as string) || ''}
                      onChange={(e) => onChange(field.id, e.target.value)}
                    />
                  )}
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

              {isOauth && oauthStatus?.authUrl && (
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
                      onClick={() => window.open(oauthStatus.authUrl, '_blank')}
                    >
                      Open link
                    </Button>
                  </div>
                </div>
              )}

              {isOauth && (
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onOauthSubmitCode}
                        disabled={!oauthCode}
                      >
                        Submit Code
                      </Button>
                      {!oauthConnected ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={onOauthStart}
                        >
                          Start Sign-in
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={onOauthRevoke}
                        >
                          Revoke
                        </Button>
                      )}
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
