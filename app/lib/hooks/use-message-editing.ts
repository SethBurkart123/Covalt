"use client";

import { useState, useCallback } from "react";
import type { Attachment, Message, PendingAttachment } from "@/lib/types/chat";
import {
  fileToBase64,
  getMediaType,
  isPendingAttachment,
  extractTextContent,
} from "@/lib/utils/message";

export function useMessageEditing() {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingAttachments, setEditingAttachments] = useState<
    (Attachment | PendingAttachment)[]
  >([]);

  const startEditing = useCallback((message: Message) => {
    if (message.role !== "user") return;

    setEditingDraft(extractTextContent(message));
    setEditingMessageId(message.id);
    setEditingAttachments(message.attachments || []);
  }, []);

  const clearEditing = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
    setEditingAttachments([]);
  }, []);

  const addAttachment = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    const type = getMediaType(file.type);
    const data = await fileToBase64(file);
    const previewUrl = type === "image" ? URL.createObjectURL(file) : undefined;

    setEditingAttachments((prev) => [
      ...prev,
      { id, type, name: file.name, mimeType: file.type, size: file.size, data, previewUrl },
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setEditingAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att && isPendingAttachment(att) && att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  return {
    editingMessageId,
    editingDraft,
    setEditingDraft,
    editingAttachments,
    startEditing,
    clearEditing,
    addAttachment,
    removeAttachment,
  };
}
