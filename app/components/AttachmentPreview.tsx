"use client";

import React, { memo, useCallback, useEffect, useState } from "react";
import { X, FileText, Music, Video, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadProgressRing } from "@/components/ui/upload-progress-ring";
import clsx from "clsx";
import type { Attachment, PendingAttachment, UploadingAttachment } from "@/lib/types/chat";
import { getAttachment } from "@/python/api";

function isUploadingAttachment(
  att: Attachment | PendingAttachment | UploadingAttachment
): att is UploadingAttachment {
  return "uploadStatus" in att;
}

interface AttachmentPreviewProps {
  attachments: (Attachment | PendingAttachment | UploadingAttachment)[];
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  readonly?: boolean;
  chatId?: string; // For loading saved attachments from backend
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

function getImageSrc(att: Attachment | PendingAttachment | UploadingAttachment): string {
  if ("previewUrl" in att && att.previewUrl) {
    return att.previewUrl;
  }

  if ("data" in att && att.data) {
    return `data:${att.mimeType};base64,${att.data}`;
  }

  return "";
}

const AttachmentItem = memo<{
  attachment: Attachment | PendingAttachment | UploadingAttachment;
  onRemove?: () => void;
  onRetry?: () => void;
  readonly?: boolean;
  chatId?: string;
}>(({ attachment, onRemove, onRetry, readonly, chatId }) => {
  const isImage = attachment.type === "image";
  const isUploading = isUploadingAttachment(attachment);
  const uploadStatus = isUploading ? attachment.uploadStatus : "uploaded";
  const uploadProgress = isUploading ? attachment.uploadProgress : 100;
  
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  
  const canRemove = !readonly && onRemove && uploadStatus !== "uploading";

  useEffect(() => {
    if (!isImage) return;
    
    const localSrc = getImageSrc(attachment);
    if (localSrc) {
      return;
    }
    
    if (!chatId) {
      return;
    }
    
    let cancelled = false;
    getAttachment({
      body: {
        chatId,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
      },
    })
      .then((response) => {
        if (cancelled) return;
        setLoadedSrc(`data:${response.mimeType};base64,${response.data}`);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load attachment:", err);
        setLoadError(true);
      });
    
    return () => {
      cancelled = true;
    };
  }, [isImage, attachment, chatId]);

  if (isImage) {
    const localSrc = getImageSrc(attachment);
    const src = localSrc || loadedSrc || "";

    return (
      <div className="relative group">
        <div
          className={clsx(
            "relative overflow-hidden rounded-lg border border-border bg-muted",
            "w-20 h-20 flex-shrink-0"
          )}
        >
          {src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={src}
              alt={attachment.name}
              className="w-full h-full object-cover"
            />
          ) : loadError ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              Error
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            </div>
          )}
          
          {isUploading && uploadStatus !== "uploaded" && (
            <UploadProgressRing
              progress={uploadProgress}
              status={uploadStatus}
              onRetry={onRetry}
            />
          )}
        </div>
        {canRemove && (
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

  return (
    <div className="relative group">
      <div
        className={clsx(
          "flex items-center gap-2 px-3 py-2 rounded-lg",
          "border border-border bg-muted",
          "max-w-[200px]",
          isUploading && uploadStatus === "uploading" && "opacity-70"
        )}
      >
        <div className="flex-shrink-0 text-muted-foreground relative">
          {getFileIcon(attachment.type)}
          {isUploading && uploadStatus === "uploading" && (
            <div className="absolute -bottom-1 -right-1">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            </div>
          )}
          {isUploading && uploadStatus === "error" && (
            <div className="absolute -bottom-1 -right-1">
              <div className="w-2 h-2 rounded-full bg-destructive" />
            </div>
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{attachment.name}</span>
          <span className="text-xs text-muted-foreground">
            {isUploading && uploadStatus === "uploading" 
              ? `${uploadProgress}%` 
              : isUploading && uploadStatus === "error"
              ? "Upload failed"
              : formatFileSize(attachment.size)
            }
          </span>
        </div>
        {canRemove && (
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
        {isUploading && uploadStatus === "error" && onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRetry}
            className="h-5 w-5 flex-shrink-0 hover:bg-primary/20 hover:text-primary"
          >
            <span className="text-xs">Retry</span>
          </Button>
        )}
      </div>
    </div>
  );
});

AttachmentItem.displayName = "AttachmentItem";

export const AttachmentPreview = memo<AttachmentPreviewProps>(({
  attachments,
  onRemove,
  onRetry,
  readonly = false,
  chatId,
}) => {
  const createRemoveHandler = useCallback(
    (id: string) => (onRemove ? () => onRemove(id) : undefined),
    [onRemove]
  );

  const createRetryHandler = useCallback(
    (id: string) => (onRetry ? () => onRetry(id) : undefined),
    [onRetry]
  );

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 w-full">
      {attachments.map((att) => (
        <AttachmentItem
          key={att.id}
          attachment={att}
          onRemove={createRemoveHandler(att.id)}
          onRetry={createRetryHandler(att.id)}
          readonly={readonly}
          chatId={chatId}
        />
      ))}
    </div>
  );
});

AttachmentPreview.displayName = "AttachmentPreview";

export default AttachmentPreview;
