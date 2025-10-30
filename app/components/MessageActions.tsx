import { useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Play, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Message, MessageSibling } from '@/lib/types/chat';

interface MessageActionsProps {
  message: Message;
  siblings: MessageSibling[];
  onContinue?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onNavigate?: (siblingId: string) => void;
  isLoading?: boolean;
}

export function MessageActions({
  message,
  siblings,
  onContinue,
  onRetry,
  onEdit,
  onNavigate,
  isLoading = false,
}: MessageActionsProps) {
  const currentIndex = siblings.findIndex(s => s.id === message.id);
  const hasPrevSibling = currentIndex > 0;
  const hasNextSibling = currentIndex < siblings.length - 1;
  const showSiblingNav = siblings.length > 1;

  const handlePrevious = () => {
    if (hasPrevSibling && onNavigate) {
      onNavigate(siblings[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (hasNextSibling && onNavigate) {
      onNavigate(siblings[currentIndex + 1].id);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      {/* Continue button for incomplete assistant messages */}
      {!message.isComplete && message.role === 'assistant' && onContinue && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onContinue}
          disabled={isLoading}
          className="h-8 px-2 text-xs"
        >
          <Play className="size-3 mr-1" />
          Continue
        </Button>
      )}

      {/* Retry button for assistant messages */}
      {message.role === 'assistant' && onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={isLoading}
          className="h-8 px-2 text-xs"
        >
          <RotateCcw className="size-3 mr-1" />
          Retry
        </Button>
      )}

      {/* Edit button for user messages */}
      {message.role === 'user' && onEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={isLoading}
          className="h-8 px-2 text-xs"
        >
          <Edit2 className="size-3 mr-1" />
          Edit
        </Button>
      )}

      {/* Sibling navigation */}
      {showSiblingNav && (
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            disabled={!hasPrevSibling || isLoading}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-2">
            {currentIndex + 1}/{siblings.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={!hasNextSibling || isLoading}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

