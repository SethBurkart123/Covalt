import type { AnyExtension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { BlockHandle, type BlockHandleCallbacks } from "@/components/markdown-editor/block-handle-extension";
import { EditableBlockMath, EditableInlineMath } from "@/components/markdown-editor/editable-math";
import { SelectableHorizontalRule } from "@/components/markdown-editor/selectable-horizontal-rule";
import { SlashCommand } from "@/components/markdown-editor/slash-command-extension";
import type { SlashCommandItem } from "@/components/markdown-editor/slash-command-suggestion";

const lowlight = createLowlight(common);

export const MARKDOWN_EDITOR_CONTENT_CLASS = "chat-input-editor-content artifact-markdown-editor-content";

interface MarkdownExtensionOptions {
  editable?: boolean;
  placeholder?: string;
  slashCommands?: SlashCommandItem[];
  blockHandle?: BlockHandleCallbacks;
}

export function createMarkdownArtifactExtensions({
  editable = true,
  placeholder = "Write markdown...",
  slashCommands = [],
  blockHandle,
}: MarkdownExtensionOptions = {}): AnyExtension[] {
  const katexOptions = { throwOnError: false };

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      horizontalRule: false,
    }),
    SelectableHorizontalRule,
    CodeBlockLowlight.configure({ lowlight }),
    Link.configure({
      autolink: true,
      defaultProtocol: "https",
      linkOnPaste: true,
      openOnClick: !editable,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true },
    }),
    Image.configure({ allowBase64: true }),
    EditableInlineMath.configure({ katexOptions }),
    EditableBlockMath.configure({ katexOptions }),
  ];

  if (editable) {
    extensions.push(SlashCommand.configure({ items: slashCommands }));
    if (blockHandle) {
      extensions.push(BlockHandle.configure(blockHandle));
    }
  }

  if (placeholder) {
    extensions.push(Placeholder.configure({ placeholder }));
  }

  return extensions;
}

export function createMarkdownArtifactEditorExtensions(
  options: MarkdownExtensionOptions = {}
): AnyExtension[] {
  return [
    ...createMarkdownArtifactExtensions(options),
    Markdown,
  ];
}

export function createMarkdownArtifactManager(): MarkdownManager {
  return new MarkdownManager({
    extensions: createMarkdownArtifactExtensions({ editable: false, placeholder: "" }),
  });
}

export function roundTripMarkdown(content: string): string {
  const manager = createMarkdownArtifactManager();
  return manager.serialize(manager.parse(content));
}
