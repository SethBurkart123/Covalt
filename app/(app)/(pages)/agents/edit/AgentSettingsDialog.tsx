'use client';

import { useState, useCallback } from 'react';
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
import { EmojiPickerPopover } from '@/components/ui/emoji-picker-popover';
import { useAgentEditor } from '@/contexts/agent-editor-context';
import { nextAgentIconValue, parseAgentIcon } from '../icon-contract';

interface AgentSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentSettingsDialog({
  open,
  onOpenChange,
}: AgentSettingsDialogProps) {
  const { agent } = useAgentEditor();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        {open && agent && (
          <AgentSettingsForm
            key={agent.id}
            agent={agent}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AgentSettingsFormProps {
  agent: NonNullable<ReturnType<typeof useAgentEditor>['agent']>;
  onOpenChange: (open: boolean) => void;
}

function AgentSettingsForm({ agent, onOpenChange }: AgentSettingsFormProps) {
  const { updateMetadata } = useAgentEditor();
  const parsedIcon = parseAgentIcon(agent.icon);

  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [icon, setIcon] = useState(parsedIcon.type === 'emoji' ? parsedIcon.value : '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        icon: nextAgentIconValue({ existingIcon: agent.icon ?? null, emoji: icon }),
      });
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update agent:', err);
      setError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  }, [name, description, icon, agent.icon, updateMetadata, onOpenChange]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Agent Settings</DialogTitle>
        <DialogDescription>
          Update your agent&apos;s name, description, and icon.
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
          <Label>Icon</Label>
          <EmojiPickerPopover
            value={icon}
            onChange={setIcon}
            placeholder="Pick an emoji..."
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
    </>
  );
}
