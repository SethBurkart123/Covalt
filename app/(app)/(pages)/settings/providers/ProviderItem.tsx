"use client";

import React, { useState } from 'react';
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
  configured: boolean;
  saving: boolean;
  saved: boolean;
  connectionStatus: 'idle' | 'testing' | 'success' | 'error';
  connectionError?: string;
  onChange: (field: keyof ProviderConfig, value: string | boolean) => void;
  onSave: () => Promise<void> | void;
  onTestConnection: () => void;
}

export default function ProviderItem({ 
  def, 
  config, 
  configured, 
  saving, 
  saved, 
  connectionStatus,
  connectionError,
  onChange, 
  onSave,
  onTestConnection
}: ProviderItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = def.icon;

  return (
    <Card className="overflow-hidden border-border/70 py-2 gap-0">
      <button
        className="w-full px-4 flex items-center justify-between transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3 text-left flex-1 min-w-0">
          <div className="rounded-md bg-muted flex items-center justify-center">
            <Icon />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium leading-none flex items-center gap-2">
              {def.name}
              
              {/* Connection status indicators */}
              {connectionStatus === 'testing' && (
                <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
              )}
              {connectionStatus === 'success' && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle size={14} />
                  Connected
                </span>
              )}
              {connectionStatus === 'error' && (
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                  <XCircle size={14} />
                  Failed
                </span>
              )}
              {connectionStatus === 'idle' && configured && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Configured
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
              {def.fields.map((field) => (
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

              <div className="flex flex-col gap-2 pt-1">
                {/* Error message */}
                {connectionError && connectionStatus === 'error' && (
                  <div className="text-xs text-red-600 dark:text-red-500 px-1">
                    {connectionError}
                  </div>
                )}
                
                {/* Action buttons */}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTestConnection();
                    }}
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
                    onClick={() => onSave()} 
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
