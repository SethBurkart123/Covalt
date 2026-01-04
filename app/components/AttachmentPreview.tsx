"use client";

import React from "react";
import { X, FileText, Music, Video, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import type { Attachment, PendingAttachment } from "@/lib/types/chat";

interface AttachmentPreviewProps {
  attachments: (Attachment | PendingAttachment)[];
  onRemove?: (id: string) => void;
  readonly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  switch (type) {
    case "audio":
      return <Music className="size-4" />;
    case "video":
      return <Video className="size-4" />;
    case "file":
      return <FileText className="size-4" />;
    default:
      return <File className="size-4" />;
  }
}

// Extended type for attachments that may include data (from frontend or backend)
interface AttachmentWithData extends Attachment {
  data?: string; // base64 encoded data
  previewUrl?: string; // blob URL (frontend pending attachments only)
}

function getImageSrc(att: Attachment | PendingAttachment): string {
  const attWithData = att as AttachmentWithData;

  // First priority: use blob URL if available (fastest for pending attachments)
  if (attWithData.previewUrl) {
    return attWithData.previewUrl;
  }

  // Second priority: use base64 data URL (works for both pending and saved)
  if (attWithData.data) {
    return `data:${att.mimeType};base64,${attWithData.data}`;
  }

  return "";
}

const AttachmentItem: React.FC<{
  attachment: Attachment | PendingAttachment;
  onRemove?: () => void;
  readonly?: boolean;
}> = ({ attachment, onRemove, readonly }) => {
  const isImage = attachment.type === "image";

  if (isImage) {
    const src = getImageSrc(attachment);

    return (
      <div className="relative group">
        <div
          className={clsx(
            "relative overflow-hidden rounded-lg border border-border bg-muted",
            "w-20 h-20 flex-shrink-0"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={attachment.name}
            className="w-full h-full object-cover"
          />
        </div>
        {!readonly && onRemove && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onRemove}
            className={clsx(
              "absolute -top-2 -right-2 h-5 w-5 rounded-full",
              "bg-muted-foreground/80 hover:bg-destructive text-background",
              "opacity-0 group-hover:opacity-100 transition-opacity"
            )}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    );
  }

  // Non-image attachments (file, audio, video)
  return (
    <div className="relative group">
      <div
        className={clsx(
          "flex items-center gap-2 px-3 py-2 rounded-lg",
          "border border-border bg-muted",
          "max-w-[200px]"
        )}
      >
        <div className="flex-shrink-0 text-muted-foreground">
          {getFileIcon(attachment.type)}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{attachment.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(attachment.size)}
          </span>
        </div>
        {!readonly && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-5 w-5 flex-shrink-0 hover:bg-destructive/20 hover:text-destructive"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  onRemove,
  readonly = false,
}) => {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 w-full">
      {attachments.map((att) => (
        <AttachmentItem
          key={att.id}
          attachment={att}
          onRemove={onRemove ? () => onRemove(att.id) : undefined}
          readonly={readonly}
        />
      ))}
    </div>
  );
};

export default AttachmentPreview;
