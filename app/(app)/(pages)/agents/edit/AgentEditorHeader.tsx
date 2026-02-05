'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Cloud, CloudOff, Loader2, Settings } from 'lucide-react';
import { useAgentEditor } from '@/contexts/agent-editor-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AgentEditorHeaderProps {
  onOpenSettings: () => void;
}

export function AgentEditorHeader({ onOpenSettings }: AgentEditorHeaderProps) {
  const router = useRouter();
  const { agent, saveStatus, updateMetadata } = useAgentEditor();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleBack = () => {
    router.push('/agents');
  };

  const startEditing = useCallback(() => {
    if (!agent) return;
    setEditValue(agent.name);
    setIsEditing(true);
  }, [agent]);

  const saveEdit = useCallback(async () => {
    if (!editValue.trim()) {
      setIsEditing(false);
      return;
    }
    
    try {
      await updateMetadata({ name: editValue.trim() });
    } catch {
      // Error already logged in context
    }
    setIsEditing(false);
  }, [editValue, updateMetadata]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [saveEdit, cancelEdit]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const SaveStatusIndicator = () => {
    switch (saveStatus) {
      case 'saving':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Saving...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Cloud className="size-3.5" />
            <span>Saved</span>
          </div>
        );
      case 'dirty':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Cloud className="size-3.5" />
            <span>Unsaved changes</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-destructive text-sm">
            <CloudOff className="size-3.5" />
            <span>Save failed</span>
          </div>
        );
    }
  };

  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background/80 backdrop-blur-sm z-10">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          className="size-8"
        >
          <ArrowLeft className="size-4" />
        </Button>

        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveEdit}
              className="text-lg font-medium bg-transparent border-b-2 border-primary outline-none px-1 min-w-[200px]"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={saveEdit}
              className="size-6"
            >
              <Check className="size-3.5" />
            </Button>
          </div>
        ) : (
          <button
            onClick={startEditing}
            className={cn(
              'text-lg font-medium hover:bg-muted/50 rounded px-2 py-1 -mx-2 -my-1 transition-colors',
              'focus:outline-none focus:bg-muted/50'
            )}
          >
            {agent?.name || 'Untitled Agent'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <SaveStatusIndicator />
        
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          className="size-8"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}
