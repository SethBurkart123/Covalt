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
import type { ModelInfo, AttachmentType, UploadingAttachment, Attachment } from "@/lib/types/chat";
import type { AgentInfo } from "@/python/api";
import { ToolSelector } from "@/components/ToolSelector";
import ModelSelector from "@/components/ModelSelector";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import {
  FileDropZone,
  FileDropZoneTrigger,
} from "@/components/ui/file-drop-zone";
import { uploadAttachment, deletePendingUpload } from "@/python/api";

interface LeftToolbarProps {
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  hideModelSelector?: boolean;
  hideToolSelector?: boolean;
  onAgentsLoaded?: (agents: AgentInfo[]) => void;
}

const LeftToolbar = memo(function LeftToolbar({
  isLoading,
  selectedModel,
  setSelectedModel,
  models,
  hideModelSelector,
  hideToolSelector,
  onAgentsLoaded,
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

      {!hideModelSelector && (
        <ModelSelector
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          models={models}
          onAgentsLoaded={onAgentsLoaded}
        />
      )}

      {!hideToolSelector && (
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
      )}
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
  onSubmit: (input: string, attachments: Attachment[]) => void;
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  canSendMessage?: boolean;
  onStop?: () => void;
  hideModelSelector?: boolean;
  hideToolSelector?: boolean;
  onAgentsLoaded?: (agents: AgentInfo[]) => void;
}

const MAX_HEIGHT = 200;

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
    hideModelSelector,
    hideToolSelector,
    onAgentsLoaded,
  }) => {
    const [input, setInput] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<UploadingAttachment[]>([]);
    
    const formRef = useRef<HTMLFormElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const hasUploadingFiles = pendingAttachments.some(
      att => att.uploadStatus === "uploading" || att.uploadStatus === "pending"
    );
    const hasUploadErrors = pendingAttachments.some(
      att => att.uploadStatus === "error"
    );

    const clearAttachments = useCallback(() => {
      setPendingAttachments((prev) => {
        prev.forEach((att) => {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        });
        return [];
      });
    }, []);

    const getUploadedAttachments = useCallback((): Attachment[] => {
      return pendingAttachments
        .filter((att) => att.uploadStatus === "uploaded")
        .map(({ id, type, name, mimeType, size }) => ({ id, type, name, mimeType, size }));
    }, [pendingAttachments]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const uploadedAttachments = getUploadedAttachments();
          const hasContent = input.trim() || uploadedAttachments.length > 0;
          
          if (hasContent && canSendMessage && !isLoading && !hasUploadingFiles && !hasUploadErrors) {
            onSubmit(input.trim(), uploadedAttachments);
            setInput("");
            clearAttachments();
          }
        }
      },
      [input, canSendMessage, isLoading, hasUploadingFiles, hasUploadErrors, onSubmit, clearAttachments, getUploadedAttachments]
    );

    const handleFormSubmit = useCallback(
      (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const uploadedAttachments = getUploadedAttachments();
        const hasContent = input.trim() || uploadedAttachments.length > 0;
        
        if (!hasContent || isLoading || !canSendMessage || hasUploadingFiles || hasUploadErrors) return;

        onSubmit(input.trim(), uploadedAttachments);
        setInput("");
        clearAttachments();
      },
      [input, isLoading, canSendMessage, hasUploadingFiles, hasUploadErrors, onSubmit, clearAttachments, getUploadedAttachments]
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
        if (isComposing || e.isComposing || e.defaultPrevented) return;

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
        const previewUrl = type === "image" ? URL.createObjectURL(file) : undefined;

        const newAttachment: UploadingAttachment = {
          id,
          type,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          previewUrl,
          uploadStatus: "uploading",
          uploadProgress: 0,
        };

        setPendingAttachments((prev) => [...prev, newAttachment]);

        try {
          const uploadHandle = uploadAttachment({ file, id });

          uploadHandle.onProgress((event) => {
            setPendingAttachments((prev) =>
              prev.map((att) =>
                att.id === id
                  ? { ...att, uploadProgress: event.percentage }
                  : att
              )
            );
          });

          await uploadHandle.promise;

          setPendingAttachments((prev) =>
            prev.map((att) =>
              att.id === id
                ? { ...att, uploadStatus: "uploaded", uploadProgress: 100 }
                : att
            )
          );
        } catch (error) {
          setPendingAttachments((prev) =>
            prev.map((att) =>
              att.id === id
                ? {
                    ...att,
                    uploadStatus: "error",
                    uploadError: error instanceof Error ? error.message : "Upload failed",
                  }
                : att
            )
          );
        }
      });
    }, []);

    const handleRemoveAttachment = useCallback((id: string) => {
      setPendingAttachments((prev) => {
        const att = prev.find((a) => a.id === id);
        if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
        
        if (att && att.uploadStatus === "uploaded") {
          deletePendingUpload({ body: { id: att.id, mimeType: att.mimeType } }).catch(() => {});
        }
        
        return prev.filter((a) => a.id !== id);
      });
    }, []);

    const handleRetryUpload = useCallback((id: string) => {
      const att = pendingAttachments.find(a => a.id === id);
      if (!att || att.uploadStatus !== "error") return;
      
      handleRemoveAttachment(id);
    }, [pendingAttachments, handleRemoveAttachment]);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
      },
      []
    );

    const canSubmit =
      canSendMessage && 
      (input.trim().length > 0 || pendingAttachments.some(att => att.uploadStatus === "uploaded")) &&
      !hasUploadingFiles &&
      !hasUploadErrors;

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
            <div className="w-full pb-2 -mt-16">
              <AttachmentPreview
                attachments={pendingAttachments}
                onRemove={handleRemoveAttachment}
                onRetry={handleRetryUpload}
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
                hideModelSelector={hideModelSelector}
                hideToolSelector={hideToolSelector}
                onAgentsLoaded={onAgentsLoaded}
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
