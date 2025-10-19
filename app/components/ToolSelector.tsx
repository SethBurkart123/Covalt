"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTools } from '@/lib/hooks/useTools';
import type { ToolInfo } from '@/lib/types/chat';

interface ToolSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
}

export function ToolSelector({ isOpen, onClose, chatId }: ToolSelectorProps) {
  const { availableTools, activeToolIds, toggleTool, isLoading } = useTools(chatId);

  // Group tools by category
  const toolsByCategory = React.useMemo(() => {
    const grouped: Record<string, ToolInfo[]> = {};
    availableTools.forEach((tool) => {
      const category = tool.category || 'Other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(tool);
    });
    return grouped;
  }, [availableTools]);

  const categoryIcons: Record<string, string> = {
    utility: '🔧',
    search: '🔍',
    other: '📦',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Popover */}
          <motion.div
            className="fixed bottom-20 left-1/2 z-50 w-[320px] rounded-2xl border bg-card shadow-lg"
            initial={{ opacity: 0, y: 20, scale: 0.95, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: 20, scale: 0.95, x: '-50%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Tools</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-1 hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tool List */}
            <div className="max-h-[400px] overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : Object.keys(toolsByCategory).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tools available
                </div>
              ) : (
                Object.entries(toolsByCategory).map(([category, tools]) => (
                  <div key={category} className="mb-4 last:mb-0">
                    {/* Category Header */}
                    <div className="mb-2 flex items-center gap-2 px-2">
                      <span className="text-base">{categoryIcons[category.toLowerCase()] || '📦'}</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {category}
                      </span>
                    </div>

                    {/* Tools in Category */}
                    <div className="space-y-1">
                      {tools.map((tool) => {
                        const isActive = activeToolIds.includes(tool.id);
                        return (
                          <motion.button
                            key={tool.id}
                            className={clsx(
                              'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                              'hover:bg-muted',
                              isActive && 'bg-muted/50'
                            )}
                            onClick={() => toggleTool(tool.id)}
                            whileTap={{ scale: 0.98 }}
                          >
                            {/* Checkbox */}
                            <div
                              className={clsx(
                                'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all',
                                isActive
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/30'
                              )}
                            >
                              {isActive && (
                                <motion.svg
                                  className="h-3 w-3 text-primary-foreground"
                                  viewBox="0 0 12 12"
                                  initial={{ scale: 0, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0, opacity: 0 }}
                                  transition={{ type: 'spring', damping: 15, stiffness: 300 }}
                                >
                                  <path
                                    fill="currentColor"
                                    d="M10.3 2.3a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4 0l-2-2a1 1 0 1 1 1.4-1.4L4.6 6.6l4.3-4.3a1 1 0 0 1 1.4 0z"
                                  />
                                </motion.svg>
                              )}
                            </div>

                            {/* Tool Info */}
                            <div className="flex-1 min-w-0">
                              <div className={clsx(
                                'text-sm font-medium',
                                isActive ? 'text-foreground' : 'text-foreground/80'
                              )}>
                                {tool.name || tool.id}
                              </div>
                              {tool.description && (
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {tool.description}
                                </div>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

