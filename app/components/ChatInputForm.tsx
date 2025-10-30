import React, { KeyboardEvent, useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Sparkles,
  MoreHorizontal,
  ArrowUp,
} from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import type { ModelInfo } from '@/lib/types/chat';
import { ToolSelector } from '@/components/ToolSelector';
import { useChat } from '@/contexts/chat-context';

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

const ModelSelector = React.memo(({ selectedModel, setSelectedModel, models }: { selectedModel: string, setSelectedModel: (model: string) => void, models: ModelInfo[] }) => {
  const [isOpen, setIsOpen] = useState(false);

  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [buttonWidth, setButtonWidth] = useState(0);

  const optionHeight = 32;
  const verticalPadding = 8;
  const optionsVisibleHeight = Math.min(10, (models.length)) * optionHeight + verticalPadding;

  // Helper to format model display name
  const formatModelDisplay = (model: ModelInfo) => {
    const providerName = model.provider.charAt(0).toUpperCase() + model.provider.slice(1);
    return `${providerName}: ${model.displayName}`;
  };

  // Helper to get model key for storage
  const getModelKey = (model: ModelInfo) => `${model.provider}:${model.modelId}`;

  // Find the currently selected model info
  const selectedModelInfo = models.find(m => getModelKey(m) === selectedModel);
  const selectedDisplayName = selectedModelInfo ? formatModelDisplay(selectedModelInfo) : selectedModel;

  useEffect(() => {
    if (buttonRef.current) {
      setButtonWidth(buttonRef.current.offsetWidth);
    }
  }, [selectedModel]);

  return (
    <LayoutGroup>
      <motion.div className="relative" layout="size" layoutId="model-selector" transition={{ type: "spring", damping: 20, stiffness: 400 }}>
        <motion.button
          ref={buttonRef}
          type="button"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm relative font-medium h-9 z-10 bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive min-w-20"
          onClick={() => setIsOpen(!isOpen)}
        >
          <motion.div
            animate={{ rotate: isOpen ? 360 : 0 }}
            transition={{ duration: 0.5, type: 'spring', damping: 20, stiffness: 300 }}
          >
            <Sparkles className="size-4" />
          </motion.div>
          <motion.span
            key={selectedModel}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {selectedDisplayName}
          </motion.span>
        </motion.button>

        <AnimatePresence>
          {isOpen && buttonWidth > 0 && (
            <motion.div
              className="absolute bottom-[-1px] rounded-2xl left-1/2 -translate-x-1/2 origin-bottom flex flex-col items-center overflow-hidden border bg-secondary shadow-lg z-0 w-auto pb-10"
              initial={{
                height: 0,
                minWidth: buttonWidth,
                filter: "blur(10px)",
              }}
              animate={{
                height: optionsVisibleHeight,
                minWidth: buttonWidth,
                transition: {
                  height: { type: "spring", stiffness: 300, damping: 27 },
                  opacity: { duration: 0.2 }
                },
                filter: "blur(0px)",
              }}
              exit={{
                height: 0,
                filter: "blur(10px)",
                transition: { duration: 0.3, ease: "easeInOut" }
              }}
              style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
            >
              <div className="flex flex-col items-center w-full p-1 overflow-y-auto">
                {models
                  .filter((model) => getModelKey(model) !== selectedModel)
                  .map((model) => {
                    const modelKey = getModelKey(model);
                    const displayName = formatModelDisplay(model);
                    return (
                      <motion.button
                        key={modelKey}
                        className={clsx(
                          "flex w-full items-center rounded-lg px-3 py-2 text-sm text-nowrap",
                          "transition-colors duration-150 justify-center relative",
                          "hover:bg-white/40 hover:border-border hover:border"
                        )}
                        style={{ height: `${optionHeight}px` }}
                        onClick={(event) => {
                          event?.preventDefault()
                          setSelectedModel(modelKey);
                          setIsOpen(false);
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ 
                          opacity: 1, 
                          transition: { duration: 0.2, ease: 'easeOut' }
                        }}
                        exit={{ 
                          opacity: 0,
                          transition: { duration: 0.2, ease: 'easeOut' }
                        }}
                        whileTap={{ scale: 0.98 }}
                      >
                        {displayName}
                      </motion.button>
                    );
                  })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
});

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

            <Button
              type="submit"
              size="icon"
              className={clsx(
                "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90",
                input.trim() && !isLoading && canSendMessage ? "opacity-100" : "cursor-not-allowed opacity-50"
              )}
              disabled={!input.trim() || isLoading || !canSendMessage}
            >
              <ArrowUp className="size-5.5" />
            </Button>
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