import {
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, ArrowUp, Square } from "lucide-react";
import clsx from "clsx";
import { LayoutGroup } from "framer-motion";
import type { ModelInfo, AttachmentType, UploadingAttachment, Attachment } from "@/lib/types/chat";
import { ToolSelector } from "@/components/ToolSelector";
import { useToolsCatalog } from "@/contexts/tools-context";
import ModelSelector from "@/components/ModelSelector";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import {
  FileDropZone,
  FileDropZoneTrigger,
} from "@/components/ui/file-drop-zone";
import { uploadAttachment, deletePendingUpload } from "@/python/api";
import {
  AtMention,
  type MentionAttrs,
  type MentionItem,
} from "@/components/chat-input/at-mention-extension";
import {
  hasMentionNodes,
  serializeChatInputMarkdown,
} from "@/components/chat-input/chat-input-markdown";

const lowlight = createLowlight(common);

interface LeftToolbarProps {
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  hideModelSelector?: boolean;
  hideToolSelector?: boolean;
}

const LeftToolbar = memo(function LeftToolbar({
  isLoading,
  selectedModel,
  setSelectedModel,
  models,
  hideModelSelector,
  hideToolSelector,
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
  onSubmit: (input: string, attachments: Attachment[], toolIds?: string[]) => void;
  isLoading: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: ModelInfo[];
  canSendMessage?: boolean;
  onStop?: () => void;
  hideModelSelector?: boolean;
  hideToolSelector?: boolean;
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
    hideModelSelector,
    hideToolSelector,
  }) => {
    const { availableTools, groupedTools, mcpServers } = useToolsCatalog();
    const [hasTextContent, setHasTextContent] = useState(false);
    const [pendingAttachments, setPendingAttachments] = useState<UploadingAttachment[]>([]);
    
    const formRef = useRef<HTMLFormElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const mentionItemsRef = useRef<MentionItem[]>([]);

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

    const mentionItems = useMemo<MentionItem[]>(() => {
      const mcpServerIds = new Set(mcpServers.map((server) => server.id));
      const toolItems = availableTools.map((tool) => {
        if (tool.id.startsWith("mcp:")) {
          const parts = tool.id.split(":");
          const serverLabel = parts[1] ?? "";
          const label = parts.slice(2).join(":") || tool.id;
          return {
            id: tool.id,
            label,
            type: "tool" as const,
            serverLabel,
          };
        }

        return {
          id: tool.id,
          label: tool.id,
          type: "tool" as const,
        };
      });

      const toolsetItems = Object.entries(groupedTools.byCategory)
        .filter(([category]) => !mcpServerIds.has(category))
        .map(([category]) => ({
          id: category,
          label: category,
          type: "toolset" as const,
        }));

      const mcpItems = mcpServers.map((server) => ({
        id: server.id,
        label: server.id,
        type: "mcp" as const,
      }));

      return [...toolItems, ...toolsetItems, ...mcpItems];
    }, [availableTools, groupedTools.byCategory, mcpServers]);

    useEffect(() => {
      mentionItemsRef.current = mentionItems;
    }, [mentionItems]);

    const getMentionSuggestions = useCallback((query: string) => {
      const normalized = query.trim().toLowerCase();
      const items = mentionItemsRef.current;
      if (!normalized) return items;

      const ranked = items
        .map((item) => {
          const label = item.label.toLowerCase();
          const serverLabel = item.serverLabel?.toLowerCase() ?? "";

          const labelStarts = label.startsWith(normalized);
          const labelIncludes = label.includes(normalized);
          const serverStarts = serverLabel ? serverLabel.startsWith(normalized) : false;
          const serverIncludes = serverLabel ? serverLabel.includes(normalized) : false;

          const matchScore = labelStarts ? 3 : labelIncludes ? 2 : serverStarts || serverIncludes ? 1 : 0;
          if (matchScore === 0) return null;

          const toolSpecific =
            item.type === "tool" &&
            item.serverLabel &&
            normalized.startsWith(serverLabel) &&
            normalized.length > serverLabel.length;

          const group = toolSpecific ? 0 : item.type === "mcp" ? 0 : 1;

          return {
            item,
            group,
            matchScore,
            labelLength: label.length,
          };
        })
        .filter((entry): entry is { item: MentionItem; group: number; matchScore: number; labelLength: number } => !!entry)
        .sort((a, b) => {
          if (a.group !== b.group) return a.group - b.group;
          if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
          if (a.labelLength !== b.labelLength) return a.labelLength - b.labelLength;
          return a.item.label.localeCompare(b.item.label);
        });

      return ranked.map((entry) => entry.item);
    }, []);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
          codeBlock: false,
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: "plaintext",
        }),
        Placeholder.configure({
          placeholder: "Ask anything",
        }),
        AtMention.configure({
          getSuggestions: getMentionSuggestions,
        }),
      ],
      editorProps: {
        attributes: {
          class: clsx(
            "chat-input-editor-content",
            "query-input",
            "prose prose-neutral dark:prose-invert !max-w-none",
            "prose-pre:rounded-lg",
            "w-full flex-1 border-none bg-transparent px-1 pt-2 text-base text-foreground",
            "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
            "min-h-[40px] max-h-[200px] overflow-y-auto"
          ),
        },
      },
    });

    useEffect(() => {
      editorRef.current = editor ?? null;
    }, [editor]);

    useEffect(() => {
      if (!editor) return;

      const update = () => {
        const text = editor.getText({ blockSeparator: "\n" }).trim();
        const hasMentions = hasMentionNodes(editor.state.doc);
        setHasTextContent(text.length > 0 || hasMentions);
      };

      update();
      editor.on("update", update);
      return () => {
        editor.off("update", update);
      };
    }, [editor]);

    const extractMentionedToolIds = useCallback(() => {
      if (!editor) return [];

      const toolIds = new Set<string>();
      const availableToolIds = new Set(availableTools.map((tool) => tool.id));

      editor.state.doc.descendants((node) => {
        if (node.type.name !== "atMention") return true;
        const attrs = node.attrs as MentionAttrs;
        if (!attrs?.id) return true;

        if (attrs.type === "tool") {
          if (availableToolIds.has(attrs.id)) {
            toolIds.add(attrs.id);
          }
          return false;
        }

        const tools = groupedTools.byCategory[attrs.id] || [];
        tools.forEach((tool) => toolIds.add(tool.id));
        return false;
      });

      return Array.from(toolIds);
    }, [editor, availableTools, groupedTools.byCategory]);

    const submitMessage = useCallback(() => {
      if (!editor) return;

      const uploadedAttachments = getUploadedAttachments();
      const markdown = serializeChatInputMarkdown(editor);
      const hasContent = markdown.trim().length > 0 || uploadedAttachments.length > 0;

      if (!hasContent || isLoading || !canSendMessage || hasUploadingFiles || hasUploadErrors) {
        return;
      }

      const mentionedToolIds = extractMentionedToolIds();
      onSubmit(markdown, uploadedAttachments, mentionedToolIds.length > 0 ? mentionedToolIds : undefined);
      editor.commands.clearContent();
      clearAttachments();
    }, [
      editor,
      getUploadedAttachments,
      isLoading,
      canSendMessage,
      hasUploadingFiles,
      hasUploadErrors,
      extractMentionedToolIds,
      onSubmit,
      clearAttachments,
    ]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submitMessage();
        }
      },
      [submitMessage]
    );

    const handleFormSubmit = useCallback(
      (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        submitMessage();
      },
      [submitMessage]
    );

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

        const nodeInspectorOpen = document.querySelector('[data-node-inspector="true"]');
        if (nodeInspectorOpen) return;

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
          !editorRef.current
        ) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        editorRef.current?.chain().focus().insertContent(e.key).run();
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

    const canSubmit =
      canSendMessage && 
      (hasTextContent || pendingAttachments.some(att => att.uploadStatus === "uploaded")) &&
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
            <EditorContent
              editor={editor}
              className="chat-input-editor"
              onKeyDown={handleKeyDown}
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
