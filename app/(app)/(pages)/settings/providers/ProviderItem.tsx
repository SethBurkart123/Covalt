"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { ProviderConfig, ProviderDefinition } from './ProviderRegistry';

interface ProviderItemProps {
  def: ProviderDefinition;
  config: ProviderConfig;
  configured: boolean;
  saving: boolean;
  saved: boolean;
  onChange: (field: keyof ProviderConfig, value: string | boolean) => void;
  onSave: () => Promise<void> | void;
}

export default function ProviderItem({ def, config, configured, saving, saved, onChange, onSave }: ProviderItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = def.icon;

  return (
    <Card className="overflow-hidden border-border/70 py-2 gap-0">
      <button
        className="w-full px-4 flex items-center justify-between transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3 text-left">
          <div className="rounded-md bg-muted flex items-center justify-center">
            <Icon />
          </div>
          <div>
            <div className="font-medium leading-none flex items-center gap-2">
              {def.name}
              {configured && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle2 size={14} /> Configured
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
                  <Input
                    id={`${def.key}-${field.id}`}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={(config[field.id] as string) || ''}
                    onChange={(e) => onChange(field.id, e.target.value)}
                  />
                </div>
              ))}

              <div className="flex items-center justify-end pt-1">
                <Button variant="secondary" onClick={() => onSave()} disabled={saving}>
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

