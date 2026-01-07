import {
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, ArrowUp, Square } from "lucide-react";
import clsx from "clsx";
import { LayoutGroup } from "framer-motion";
import type { ModelInfo, PendingAttachment, AttachmentType } from "@/lib/types/chat";
import { ToolSelector } from "@/components/ToolSelector";
import ModelSelector from "@/components/ModelSelector";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import {
  FileDropZone,
  FileDropZoneTrigger,
} from "@/components/ui/file-drop-zone";

interface LeftToolbarProps {
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
}

const LeftToolbar = memo(function LeftToolbar({
  isLoading,
  selectedModel,
  setSelectedModel,
  models,
}: LeftToolbarProps) {
  return (
    <>
      <FileDropZoneTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9 flex-shrink-0 rounded-full p-2"
          disabled={isLoading}
        >
          <Plus className="size-5" />
        </Button>
      </FileDropZoneTrigger>

      <ModelSelector
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        models={models}
      />

      <ToolSelector>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9 flex-shrink-0 rounded-full p-2"
          disabled={isLoading}
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </ToolSelector>
    </>
  );
});

interface SubmitButtonProps {
  isLoading: boolean;
  canSubmit: boolean;
  onStop?: () => void;
}

const SubmitButton = memo(function SubmitButton({
  isLoading,
  canSubmit,
  onStop,
}: SubmitButtonProps) {
  if (isLoading) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onStop}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Square className="size-4" fill="currentColor" />
      </Button>
    );
  }

  return (
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
  );
});

interface ChatInputFormProps {
  onSubmit: (input: string, attachments: PendingAttachment[]) => void;
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  canSendMessage?: boolean;
  onStop?: () => void;
}

const MAX_HEIGHT = 200;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMediaType(mimeType: string): AttachmentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

const ChatInputForm: React.FC<ChatInputFormProps> = memo(
  ({
    onSubmit,
    isLoading,
    selectedModel,
    setSelectedModel,
    models,
    canSendMessage = true,
    onStop,
  }) => {
    const [input, setInput] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
    
    const formRef = useRef<HTMLFormElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const clearAttachments = useCallback(() => {
      setPendingAttachments((prev) => {
        prev.forEach((att) => {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        });
        return [];
      });
    }, []);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const hasContent = input.trim() || pendingAttachments.length > 0;
          if (hasContent && canSendMessage && !isLoading) {
            onSubmit(input.trim(), pendingAttachments);
            setInput("");
            clearAttachments();
          }
        }
      },
      [input, pendingAttachments, canSendMessage, isLoading, onSubmit, clearAttachments]
    );

    const handleFormSubmit = useCallback(
      (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const hasContent = input.trim() || pendingAttachments.length > 0;
        if (!hasContent || isLoading || !canSendMessage) return;

        onSubmit(input.trim(), pendingAttachments);
        setInput("");
        clearAttachments();
      },
      [input, pendingAttachments, isLoading, canSendMessage, onSubmit, clearAttachments]
    );

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
    }, [input]);

    useEffect(() => {
      if (!canSendMessage) return;

      let isComposing = false;

      const handleCompositionStart = () => {
        isComposing = true;
      };

      const handleCompositionEnd = () => {
        isComposing = false;
      };

      const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
        if (isComposing || e.isComposing) return;

        const activeElement = document.activeElement;
        const isInputFocused =
          activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA" ||
          activeElement?.getAttribute("contenteditable") === "true";

        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        const hasModifiers = e.metaKey || e.ctrlKey || e.altKey;

        const specialKeys = [
          "Escape",
          "Tab",
          "Enter",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
          "Insert",
          "Delete",
          "Backspace",
          "F1",
          "F2",
          "F3",
          "F4",
          "F5",
          "F6",
          "F7",
          "F8",
          "F9",
          "F10",
          "F11",
          "F12",
          "PrintScreen",
          "ScrollLock",
          "Pause",
        ];
        const isPrintableKey =
          e.key.length === 1 && !specialKeys.includes(e.key);

        if (
          isInputFocused ||
          hasSelection ||
          hasModifiers ||
          !isPrintableKey ||
          activeElement === inputRef.current
        ) {
          return;
        }

        const textarea = inputRef.current;
        if (!textarea) return;

        e.preventDefault();
        e.stopPropagation();
        textarea.focus();

        setInput((currentInput) => {
          const start = textarea.selectionStart ?? currentInput.length;
          const end = textarea.selectionEnd ?? currentInput.length;
          const newValue = currentInput.slice(0, start) + e.key + currentInput.slice(end);

          requestAnimationFrame(() => {
            textarea.setSelectionRange(start + 1, start + 1);
          });

          return newValue;
        });
      };

      window.addEventListener("keydown", handleGlobalKeyDown);
      window.addEventListener("compositionstart", handleCompositionStart);
      window.addEventListener("compositionend", handleCompositionEnd);

      return () => {
        window.removeEventListener("keydown", handleGlobalKeyDown);
        window.removeEventListener("compositionstart", handleCompositionStart);
        window.removeEventListener("compositionend", handleCompositionEnd);
      };
    }, [canSendMessage]);

    const handleFilesDrop = useCallback((files: File[]) => {
      files.forEach(async (file) => {
        const id = crypto.randomUUID();
        const type = getMediaType(file.type);
        const data = await fileToBase64(file);
        const previewUrl = type === "image" ? URL.createObjectURL(file) : undefined;

        setPendingAttachments((prev) => [
          ...prev,
          {
            id,
            type,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            data,
            previewUrl,
          },
        ]);
      });
    }, []);

    const handleRemoveAttachment = useCallback((id: string) => {
      setPendingAttachments((prev) => {
        const att = prev.find((a) => a.id === id);
        if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
        return prev.filter((a) => a.id !== id);
      });
    }, []);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
      },
      []
    );

    const canSubmit =
      canSendMessage && (input.trim().length > 0 || pendingAttachments.length > 0);

    return (
      <form
        ref={formRef}
        onSubmit={handleFormSubmit}
        className={clsx(
          "relative flex flex-col items-center gap-2 rounded-3xl max-w-4xl mx-auto border border-border bg-card p-3 shadow-lg",
          "chat-input-form"
        )}
      >
        <FileDropZone
          onFilesDrop={handleFilesDrop}
          disabled={isLoading || !canSendMessage}
          className="w-full"
        >
          {pendingAttachments.length > 0 && (
            <div className="w-full pb-2">
              <AttachmentPreview
                attachments={pendingAttachments}
                onRemove={handleRemoveAttachment}
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
                "query-input"
              )}
              placeholder="Ask anything"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />
          </div>

          <div className="flex w-full items-center gap-2 pt-2">
            <LayoutGroup>
              <LeftToolbar
                isLoading={isLoading}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                models={models}
              />

              <div className="flex-1" />

              <SubmitButton
                isLoading={isLoading}
                canSubmit={canSubmit}
                onStop={onStop}
              />
            </LayoutGroup>
          </div>
        </FileDropZone>
      </form>
    );
  }
);

ChatInputForm.displayName = "ChatInputForm";

export default ChatInputForm;
