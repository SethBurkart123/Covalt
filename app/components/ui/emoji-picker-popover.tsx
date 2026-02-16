'use client';

import { useState, useCallback } from 'react';
import { type Emoji } from 'frimousse';
import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  EmojiPicker,
  EmojiPickerSearch,
  EmojiPickerContent,
  EmojiPickerFooter,
} from '@/components/ui/emoji-picker';

interface EmojiPickerPopoverProps {
  value: string;
  onChange: (emoji: string) => void;
  placeholder?: string;
}

export function EmojiPickerPopover({
  value,
  onChange,
  placeholder = 'Pick an emoji...',
}: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      onChange(emoji);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start text-xl h-10"
        >
          {value ? (
            <span>{value}</span>
          ) : (
            <span className="text-muted-foreground text-sm font-normal">
              {placeholder}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-fit p-0" 
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <button
            onClick={() => setOpen(false)}
            className="absolute right-2 top-2 z-10 rounded-sm p-1 opacity-70 hover:opacity-100 hover:bg-accent transition-opacity"
          >
            <X className="size-4" />
          </button>
          <EmojiPicker
            className="h-96 w-80"
            onEmojiSelect={(emoji: Emoji) => handleEmojiSelect(emoji.emoji)}
          >
            <EmojiPickerSearch placeholder="Search emoji..." />
            <EmojiPickerContent />
            <EmojiPickerFooter />
          </EmojiPicker>
        </div>
      </PopoverContent>
    </Popover>
  );
}
