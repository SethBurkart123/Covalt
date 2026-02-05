'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Cloud, CloudOff, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

interface AgentEditorHeaderLeftProps {
  agentName: string;
  onUpdateName: (name: string) => Promise<void>;
}

export function AgentEditorHeaderLeft({ agentName, onUpdateName }: AgentEditorHeaderLeftProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(agentName);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditValue(agentName);
    setIsEditing(true);
  }, [agentName]);

  const saveEdit = useCallback(async () => {
    if (!editValue.trim()) {
      setIsEditing(false);
      return;
    }
    try {
      await onUpdateName(editValue.trim());
    } catch {}
    setIsEditing(false);
  }, [editValue, onUpdateName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') saveEdit();
      else if (e.key === 'Escape') setIsEditing(false);
    },
    [saveEdit]
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(agentName);
  }, [agentName]);

  const breadcrumb = (
    <>
      <Link href="/agents" className="text-muted-foreground hover:text-foreground truncate shrink-0">
        Agents
      </Link>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </>
  );

  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5 text-lg font-medium min-w-0">
        {breadcrumb}
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={saveEdit}
          className="font-medium bg-transparent border-b-2 border-primary outline-none px-1 min-w-[200px] flex-1 min-w-0"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-lg font-medium min-w-0">
      {breadcrumb}
      <button
        type="button"
        onClick={startEditing}
        className={cn(
          'truncate hover:bg-muted/50 rounded px-2 py-1 -mx-2 -my-1 transition-colors text-left',
          'focus:outline-none focus:bg-muted/50'
        )}
      >
        {agentName || 'Untitled Agent'}
      </button>
    </div>
  );
}

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
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
}

interface AgentEditorHeaderRightProps {
  saveStatus: SaveStatus;
  onOpenSettings: () => void;
}

export function AgentEditorHeaderRight({ saveStatus, onOpenSettings }: AgentEditorHeaderRightProps) {
  return (
    <>
      <SaveStatusIndicator status={saveStatus} />
      <Button variant="ghost" size="icon" onClick={onOpenSettings} className="size-8">
        <Settings className="size-4" />
      </Button>
    </>
  );
}
