import { ChevronLeft, ChevronRight, RotateCcw, Play, Edit2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
  const [copied, setCopied] = useState(false);
  const currentIndex = siblings.findIndex(s => s.id === message.id);
  const hasPrevSibling = currentIndex > 0;
  const hasNextSibling = currentIndex < siblings.length - 1;
  const showSiblingNav = siblings.length > 1;
  const modelLabel = (message.role === 'assistant' && typeof (message as any).modelUsed === 'string')
    ? (message as any).modelUsed
    : undefined;

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

  const handleCopy = async () => {
    let textToCopy = '';
    
    if (typeof message.content === 'string') {
      textToCopy = message.content;
    } else if (Array.isArray(message.content)) {
      // Extract text from content blocks
      textToCopy = message.content
        .filter(block => block.type === 'text')
        .map(block => block.content)
        .join('\n\n');
    }
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Copy button - available for all messages */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 w-7 p-0"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied!' : 'Copy message'}</TooltipContent>
      </Tooltip>

      {/* Continue button for any assistant message */}
      {message.role === 'assistant' && onContinue && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onContinue}
              disabled={isLoading}
              className="h-7 w-7 p-0"
            >
              <Play className="size-3.5 mr-1" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Continue generation</TooltipContent>
        </Tooltip>
      )}

      {/* Retry button for assistant messages */}
      {message.role === 'assistant' && onRetry && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={isLoading}
              className="h-7 w-7 p-0"
            >
              <RotateCcw className="size-3.5 mr-1" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry generation</TooltipContent>
        </Tooltip>
      )}

      {/* Edit button for user messages */}
      {message.role === 'user' && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={isLoading}
              className="h-7 px-2 text-xs"
            >
              <Edit2 className="size-3.5 mr-1" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit message</TooltipContent>
        </Tooltip>
      )}

      {/* Sibling navigation */}
      {showSiblingNav && (
        <div className="flex items-center gap-0.5 ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevious}
                disabled={!hasPrevSibling || isLoading}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Previous version</TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground px-1.5">
            {currentIndex + 1}/{siblings.length}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNext}
                disabled={!hasNextSibling || isLoading}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Next version</TooltipContent>
          </Tooltip>
        </div>
      )}

      {message.role === 'assistant' && modelLabel && (
        <span className="text-[11px] text-muted-foreground px-1.5">
          {modelLabel}
        </span>
      )}
    </div>
  );
}
