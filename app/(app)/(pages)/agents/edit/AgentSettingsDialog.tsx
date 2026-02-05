'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAgentEditor } from '@/contexts/agent-editor-context';

interface AgentSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentSettingsDialog({
  open,
  onOpenChange,
}: AgentSettingsDialogProps) {
  const { agent, updateMetadata } = useAgentEditor();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && agent) {
      setName(agent.name);
      setDescription(agent.description || '');
      const iconValue = agent.icon?.startsWith('emoji:') 
        ? agent.icon.slice(6) 
        : '';
      setIcon(iconValue);
    }
  }, [open, agent]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updateMetadata({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon.trim() ? `emoji:${icon.trim()}` : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update agent:', err);
      setError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  }, [name, description, icon, updateMetadata, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Agent Settings</DialogTitle>
          <DialogDescription>
            Update your agent's name, description, and icon.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this agent do?"
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="settings-icon">Icon</Label>
            <Input
              id="settings-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Paste an emoji..."
              className="text-xl"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
