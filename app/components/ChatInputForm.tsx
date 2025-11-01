import React, { KeyboardEvent, useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  MoreHorizontal,
  ArrowUp,
  Square,
} from "lucide-react";
import clsx from "clsx";
import { motion, LayoutGroup } from 'framer-motion';
import type { ModelInfo } from '@/lib/types/chat';
import { ToolSelector } from '@/components/ToolSelector';
import { useChat } from '@/contexts/chat-context';
import ModelSelector from '@/components/ModelSelector';

interface ChatInputFormProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  getModelName?: (modelId: string) => string;
  canSendMessage?: boolean;
  onStop?: () => void;
}

const MAX_HEIGHT = 200;

// Scrolling text component for long model names
const ScrollingText = React.memo(({ text, className = "" }: { text: string; className?: string }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textRef.current && containerRef.current) {
      setShouldScroll(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [text]);

  return (
    <div 
      ref={containerRef}
      className={clsx("relative overflow-hidden", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <motion.span
        ref={textRef}
        className="inline-block whitespace-nowrap"
        animate={isHovered && shouldScroll ? {
          x: [`0%`, `-100%`],
        } : {
          x: 0
        }}
        transition={isHovered && shouldScroll ? {
          x: {
            repeat: Infinity,
            repeatType: "loop",
            duration: 5,
            ease: "linear",
          },
        } : {}}
      >
        {text}
        {isHovered && shouldScroll && (
          <span className="pl-8">{text}</span>
        )}
      </motion.span>
    </div>
  );
});

ScrollingText.displayName = 'ScrollingText';

const ChatInputForm: React.FC<ChatInputFormProps> = React.memo(({
  input,
  handleInputChange,
  handleSubmit,
  isLoading,
  inputRef,
  selectedModel,
  setSelectedModel,
  models,
  canSendMessage = true,
  onStop,
}) => {
  const { chatId } = useChat();
  const [isToolSelectorOpen, setIsToolSelectorOpen] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form && input.trim()) {
        form.requestSubmit();
      }
    }
  };

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const adjustHeight = () => {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
      textarea.style.height = `${newHeight}px`;
    };

    adjustHeight();

    // Create a new ResizeObserver
    const resizeObserver = new ResizeObserver(adjustHeight);
    resizeObserver.observe(textarea);

    return () => {
      resizeObserver.disconnect();
    };
  }, [input, inputRef]);

  return (
    <motion.form
      onSubmit={handleSubmit}
      className={clsx(
        "relative flex flex-col items-center gap-2 rounded-3xl max-w-4xl mx-auto border border-border bg-card px-4 py-3 shadow-lg",
        "max-h-[calc(200px+4rem)]",
        "chat-input-form",
      )}
    >
      <div className="w-full min-h-[40px] max-h-[200px]">
        <textarea
          ref={inputRef}
          className={clsx(
            "w-full flex-1 border-none bg-transparent pt-2 px-1 text-lg shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-muted-foreground resize-none h-full",
            "min-h-[40px] max-h-[200px] overflow-y-auto",
            "query-input",
            !canSendMessage && "opacity-50 cursor-not-allowed"
          )}
          placeholder={canSendMessage ? "Ask anything" : "Complete or retry the previous message first"}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!canSendMessage}
        />
      </div>

      <div className="flex w-full items-center gap-2 pt-2">
        <LayoutGroup>
          <LayoutGroup>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 flex-shrink-0 rounded-full p-2"
              disabled={isLoading}
              onClick={() => setIsToolSelectorOpen(!isToolSelectorOpen)}
            >
              <Plus className="size-5" />
            </Button>
          </LayoutGroup>
          <ModelSelector selectedModel={selectedModel} setSelectedModel={setSelectedModel} models={models} />
          <LayoutGroup>
            <Button
              type="button"
              variant="secondary"
              className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium h-9"
              disabled={isLoading}
            >
              <Search className="size-4" />
              Deep research
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 flex-shrink-0 rounded-full p-2"
              disabled={isLoading}
            >
              <MoreHorizontal className="size-5" />
            </Button>

            <div className="flex-1" />

            {isLoading ? (
              <Button
                type="button"
                size="icon"
                onClick={onStop}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Square className="size-4" fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className={clsx(
                  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90",
                  input.trim() && canSendMessage ? "opacity-100" : "cursor-not-allowed opacity-50"
                )}
                disabled={!input.trim() || !canSendMessage}
              >
                <ArrowUp className="size-5.5" />
              </Button>
            )}
          </LayoutGroup>
        </LayoutGroup>
      </div>

      {/* Tool Selector Popover */}
      <ToolSelector 
        isOpen={isToolSelectorOpen} 
        onClose={() => setIsToolSelectorOpen(false)}
        chatId={chatId}
      />
    </motion.form>
  );
});

ChatInputForm.displayName = 'ChatInputForm';

export default ChatInputForm; 