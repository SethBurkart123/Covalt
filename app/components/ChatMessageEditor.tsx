import { Attachment, PendingAttachment } from "@/lib/types/chat";
import { useCallback, useEffect, useRef } from "react";
import { FileDropZone, FileDropZoneTrigger } from "./ui/file-drop-zone";
import { AttachmentPreview } from "./AttachmentPreview";
import { Button } from "./ui/button";
import { Plus } from "lucide-react";

export default function ChatMessageEditor({
  value,
  onChange,
  onCancel,
  onSubmit,
  attachments = [],
  onAddAttachment,
  onRemoveAttachment,
  isLoading = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  attachments?: (Attachment | PendingAttachment)[];
  onAddAttachment?: (file: File) => void;
  onRemoveAttachment?: (id: string) => void;
  isLoading?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Focus and select all text
    ta.focus();
    ta.select();

    const adjust = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    };
    adjust();
    const ro = new ResizeObserver(adjust);
    ro.observe(ta);
    return () => ro.disconnect();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    },
    [onSubmit, onCancel],
  );

  const handleFilesDrop = useCallback(
    (files: File[]) => {
      if (!onAddAttachment) return;
      files.forEach((file) => {
        onAddAttachment(file);
      });
    },
    [onAddAttachment]
  );

  return (
    <FileDropZone
      onFilesDrop={handleFilesDrop}
      disabled={isLoading}
      className="w-full"
    >
      <div className="rounded-3xl bg-muted text-muted-foreground p-3">
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
            ref={textareaRef}
            className="w-full border-none bg-transparent px-1 text-base shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={isLoading}
          />
        </div>
        <div className="flex items-center gap-2 pt-2 justify-between">
          <FileDropZoneTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 flex-shrink-0 rounded-full p-2"
              disabled={isLoading}
            >
              <Plus className="size-4" />
            </Button>
          </FileDropZoneTrigger>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded-full border border-border hover:bg-accent text-sm"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-8 px-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm disabled:opacity-50"
              onClick={onSubmit}
              disabled={(!value.trim() && attachments.length === 0) || isLoading}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </FileDropZone>
  );
}
