import type {
  Attachment,
  AttachmentType,
  ContentBlock,
  Message,
  PendingAttachment,
} from "@/lib/types/chat";

export async function fileToBase64(file: File): Promise<string> {
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

export function getMediaType(mimeType: string): AttachmentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export function isPendingAttachment(
  att: Attachment | PendingAttachment
): att is PendingAttachment {
  return "data" in att && typeof att.data === "string";
}

export function createUserMessage(
  content: string,
  attachments?: (Attachment | PendingAttachment)[]
): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    isComplete: true,
    sequence: 1,
    attachments: attachments?.map((att) => {
      if (isPendingAttachment(att)) {
        const { data, previewUrl, ...rest } = att;
        void previewUrl;
        return {
          ...rest,
          ...(data ? { data } : {}),
        };
      }
      return att;
    }) as Attachment[],
  };
}

export function createErrorMessage(error: unknown): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: [{ type: "error", content: `Sorry, there was an error: ${error}` }],
    isComplete: false,
    sequence: 1,
  };
}

export function createAssistantMessage(content: ContentBlock[] | string): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    isComplete: true,
    sequence: 1,
  };
}

export function extractTextContent(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: ContentBlock) => b?.type === "text" && typeof b.content === "string")
      .map((b: ContentBlock) => (b as { type: "text"; content: string }).content)
      .join("\n\n");
  }
  return "";
}
