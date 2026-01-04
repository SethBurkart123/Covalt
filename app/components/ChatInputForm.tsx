import React, {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Plus,
  MoreHorizontal,
  ArrowUp,
  Square,
  Paperclip,
} from "lucide-react";
import clsx from "clsx";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";
import type { ModelInfo, PendingAttachment } from "@/lib/types/chat";
import { ToolSelector } from "@/components/ToolSelector";
import ModelSelector from "@/components/ModelSelector";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  // Attachment props
  attachments?: PendingAttachment[];
  onAddAttachment?: (file: File) => void;
  onRemoveAttachment?: (id: string) => void;
}

const MAX_HEIGHT = 200;

// Scrolling text component for long model names
const ScrollingText = React.memo(
  ({ text, className = "" }: { text: string; className?: string }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [shouldScroll, setShouldScroll] = useState(false);
    const textRef = React.useRef<HTMLSpanElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (textRef.current && containerRef.current) {
        setShouldScroll(
          textRef.current.scrollWidth > containerRef.current.clientWidth
        );
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
          animate={
            isHovered && shouldScroll
              ? {
                  x: [`0%`, `-100%`],
                }
              : {
                  x: 0,
                }
          }
          transition={
            isHovered && shouldScroll
              ? {
                  x: {
                    repeat: Infinity,
                    repeatType: "loop",
                    duration: 5,
                    ease: "linear",
                  },
                }
              : {}
          }
        >
          {text}
          {isHovered && shouldScroll && <span className="pl-8">{text}</span>}
        </motion.span>
      </div>
    );
  }
);

ScrollingText.displayName = "ScrollingText";

const ChatInputForm: React.FC<ChatInputFormProps> = React.memo(
  ({
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
    attachments = [],
    onAddAttachment,
    onRemoveAttachment,
  }) => {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const dragCounterRef = useRef(0);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const form = e.currentTarget.form;
        if (form && (input.trim() || attachments.length > 0)) {
          form.requestSubmit();
        }
      }
    };

    useEffect(() => {
      const textarea = inputRef.current;
      if (!textarea) return;

      const adjustHeight = () => {
        textarea.style.height = "auto";
        const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
        textarea.style.height = `${newHeight}px`;
      };

      adjustHeight();

      const resizeObserver = new ResizeObserver(adjustHeight);
      resizeObserver.observe(textarea);

      return () => {
        resizeObserver.disconnect();
      };
    }, [input, inputRef]);

    // Handle file selection from input
    const handleFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || !onAddAttachment) return;

        Array.from(files).forEach((file) => {
          onAddAttachment(file);
        });

        // Reset input so the same file can be selected again
        e.target.value = "";
      },
      [onAddAttachment]
    );

    // Drag and drop handlers
    const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setIsDragging(true);
      }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0;

        if (!onAddAttachment) return;

        const files = e.dataTransfer.files;
        Array.from(files).forEach((file) => {
          onAddAttachment(file);
        });
      },
      [onAddAttachment]
    );

    const canSubmit =
      canSendMessage && (input.trim() || attachments.length > 0);

    return (
      <motion.form
        ref={formRef}
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={clsx(
          "relative flex flex-col items-center gap-2 rounded-3xl max-w-4xl mx-auto border border-border bg-card px-4 py-3 shadow-lg",
          "chat-input-form",
          isDragging && "ring-2 ring-primary ring-offset-2"
        )}
      >
        {/* Drag overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-primary/10 backdrop-blur-sm"
            >
              <div className="flex flex-col items-center gap-2 text-primary">
                <Paperclip className="size-8" />
                <span className="text-sm font-medium">Drop files here</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          accept="image/*,application/pdf,audio/*,video/*,.txt,.csv,.json,.doc,.docx"
          className="hidden"
        />

        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div className="w-full pb-2">
            <AttachmentPreview
              attachments={attachments}
              onRemove={onRemoveAttachment}
            />
          </div>
        )}

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
            placeholder={
              canSendMessage
                ? "Ask anything"
                : "Complete or retry the previous message first"
            }
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
              {/* Attachment button (repurposed +) */}
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-9 w-9 flex-shrink-0 rounded-full p-2"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus className="size-5" />
              </Button>
            </LayoutGroup>
            <ModelSelector
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              models={models}
            />
            <LayoutGroup>
              {/* More options menu with ToolSelector */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 flex-shrink-0 rounded-full p-2"
                    disabled={isLoading}
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-auto p-2"
                  side="top"
                >
                  <ToolSelector>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start gap-2"
                    >
                      <Plus className="size-4" />
                      Tools
                    </Button>
                  </ToolSelector>
                </PopoverContent>
              </Popover>

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
                    canSubmit ? "opacity-100" : "cursor-not-allowed opacity-50"
                  )}
                  disabled={!canSubmit}
                >
                  <ArrowUp className="size-5.5" />
                </Button>
              )}
            </LayoutGroup>
          </LayoutGroup>
        </div>
      </motion.form>
    );
  }
);

ChatInputForm.displayName = "ChatInputForm";

export default ChatInputForm;
