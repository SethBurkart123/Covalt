"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import {
  Bold,
  ChevronDown,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  ListTodo,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Sigma,
  Strikethrough,
  Table,
  Trash2,
} from "lucide-react";
import { ArtifactFileEditorFrame } from "@/components/ArtifactFileEditorFrame";
import type { SlashCommandItem } from "@/components/markdown-editor/slash-command-suggestion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useArtifactFileEditorState } from "@/hooks/use-artifact-file-editor-state";
import {
  createMarkdownArtifactEditorExtensions,
  MARKDOWN_EDITOR_CONTENT_CLASS,
} from "@/lib/markdown-editor";
import { cn } from "@/lib/utils";

interface EditableMarkdownViewerProps {
  filePath?: string;
  content?: string;
  readOnly?: boolean;
}

export function EditableMarkdownViewer({
  filePath,
  content,
  readOnly = false,
}: EditableMarkdownViewerProps) {
  const isContentMode = !filePath && content !== undefined;
  const {
    currentContent,
    syncedContent,
    isLoading,
    isDeleted,
    effectiveReadOnly,
    saveStatus,
    errorMessage,
    isDesynced,
    acceptExternalChanges,
    updateContent,
  } = useArtifactFileEditorState({ filePath, content, readOnly });

  const isEditable = !effectiveReadOnly && !isDeleted;
  const slashCommands = useMemo(() => createSlashCommands(), []);

  const [blockMenu, setBlockMenu] = useState<{ pos: number; rect: DOMRect } | null>(null);
  const blockMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const blockHandle = useMemo(() => ({
    onOpen: (pos: number, rect: DOMRect) => {
      setBlockMenu({ pos, rect });
      // Trigger the dropdown via a microtask so the ref is set
      requestAnimationFrame(() => blockMenuTriggerRef.current?.click());
    },
    onClose: () => setBlockMenu(null),
  }), []);

  const extensions = useMemo(
    () => createMarkdownArtifactEditorExtensions({
      editable: isEditable,
      slashCommands,
      blockHandle: isEditable ? blockHandle : undefined,
    }),
    [isEditable, slashCommands, blockHandle]
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: currentContent,
      contentType: "markdown",
      editable: isEditable,
      editorProps: {
        attributes: {
          class: cn(MARKDOWN_EDITOR_CONTENT_CLASS, "min-h-full px-8 py-4 text-sm focus:outline-none"),
        },
      },
    },
    [extensions]
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditable);
  }, [editor, isEditable]);

  useEffect(() => {
    if (!editor) return;
    if (editor.getMarkdown() === currentContent) return;
    editor.commands.setContent(currentContent, { contentType: "markdown", emitUpdate: false });
  }, [currentContent, editor]);

  useEffect(() => {
    if (!editor || !isEditable) return;
    const handleUpdate = () => updateContent(editor.getMarkdown());
    editor.on("update", handleUpdate);
    return () => { editor.off("update", handleUpdate); };
  }, [editor, isEditable, updateContent]);

  if (!isContentMode && isLoading && !syncedContent) {
    return <LoadingState label="Loading file..." />;
  }

  return (
    <ArtifactFileEditorFrame
      filePath={filePath}
      isDeleted={isDeleted}
      isDesynced={isDesynced}
      saveStatus={saveStatus}
      errorMessage={errorMessage}
      onDiscardChanges={acceptExternalChanges}
    >
      <div className="relative h-full overflow-auto">
        {editor ? (
          <>
            {isEditable && (
              <>
                <BubbleMenu
                  editor={editor}
                  pluginKey="artifactBubbleMenu"
                  shouldShow={(props) => {
                    if (props.from === props.to) return false;
                    if (props.editor.isActive("codeBlock")) return false;
                    return true;
                  }}
                  className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md"
                >
                  <BubbleMenuToolbar editor={editor} />
                </BubbleMenu>

                <FloatingMenu
                  editor={editor}
                  pluginKey="artifactFloatingMenu"
                  shouldShow={(props) => {
                    if (!props.editor.isEditable) return false;
                    const { empty, $from } = props.state.selection;
                    if (!empty) return false;
                    if ($from.parent.type.name !== "paragraph") return false;
                    return $from.parent.textContent.length === 0;
                  }}
                  className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md"
                >
                  <FloatingMenuToolbar editor={editor} />
                </FloatingMenu>

                <BlockHandleMenu
                  editor={editor}
                  blockMenu={blockMenu}
                  triggerRef={blockMenuTriggerRef}
                  onClose={() => setBlockMenu(null)}
                />
              </>
            )}
            <EditorContent editor={editor} className="h-full" />
          </>
        ) : (
          <LoadingState label="Loading editor..." />
        )}
      </div>
    </ArtifactFileEditorFrame>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-6 w-6 animate-spin" />
      {label}
    </div>
  );
}

const BLOCK_TYPES = [
  { key: "paragraph", label: "Text", icon: <Pilcrow className="size-4" /> },
  { key: "heading-1", label: "Heading 1", icon: <Heading1 className="size-4" /> },
  { key: "heading-2", label: "Heading 2", icon: <Heading2 className="size-4" /> },
  { key: "heading-3", label: "Heading 3", icon: <Heading3 className="size-4" /> },
  { key: "bulletList", label: "Bullet list", icon: <List className="size-4" /> },
  { key: "orderedList", label: "Numbered list", icon: <ListOrdered className="size-4" /> },
  { key: "taskList", label: "Task list", icon: <ListTodo className="size-4" /> },
  { key: "blockquote", label: "Quote", icon: <Quote className="size-4" /> },
  { key: "codeBlock", label: "Code block", icon: <Code className="size-4" /> },
  { key: "blockMath", label: "Math block", icon: <Sigma className="size-4" /> },
  { key: "horizontalRule", label: "Divider", icon: <Minus className="size-4" /> },
] as const;

function getCurrentBlockType(editor: Editor) {
  if (editor.isActive("heading", { level: 1 })) return BLOCK_TYPES[1];
  if (editor.isActive("heading", { level: 2 })) return BLOCK_TYPES[2];
  if (editor.isActive("heading", { level: 3 })) return BLOCK_TYPES[3];
  if (editor.isActive("bulletList")) return BLOCK_TYPES[4];
  if (editor.isActive("orderedList")) return BLOCK_TYPES[5];
  if (editor.isActive("taskList")) return BLOCK_TYPES[6];
  if (editor.isActive("blockquote")) return BLOCK_TYPES[7];
  if (editor.isActive("codeBlock")) return BLOCK_TYPES[8];
  if (editor.isActive("blockMath")) return BLOCK_TYPES[9];
  if (editor.isActive("horizontalRule")) return BLOCK_TYPES[10];
  return BLOCK_TYPES[0]; // Text
}

function applyBlockType(editor: Editor, key: string) {
  const chain = editor.chain().focus();
  switch (key) {
    case "paragraph": chain.setParagraph().run(); break;
    case "heading-1": chain.setHeading({ level: 1 }).run(); break;
    case "heading-2": chain.setHeading({ level: 2 }).run(); break;
    case "heading-3": chain.setHeading({ level: 3 }).run(); break;
    case "bulletList": chain.toggleBulletList().run(); break;
    case "orderedList": chain.toggleOrderedList().run(); break;
    case "taskList": chain.toggleTaskList().run(); break;
    case "blockquote": chain.toggleBlockquote().run(); break;
    case "codeBlock": chain.toggleCodeBlock().run(); break;
  }
}

function BlockHandleMenu({
  editor,
  blockMenu,
  triggerRef,
  onClose,
}: {
  editor: Editor;
  blockMenu: { pos: number; rect: DOMRect } | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const deleteBlock = useCallback(() => {
    if (!blockMenu) return;
    const { state, dispatch } = editor.view;
    const node = state.doc.nodeAt(blockMenu.pos);
    if (!node) return;
    dispatch(state.tr.delete(blockMenu.pos, blockMenu.pos + node.nodeSize));
    onClose();
  }, [editor, blockMenu, onClose]);

  const duplicateBlock = useCallback(() => {
    if (!blockMenu) return;
    const { state, dispatch } = editor.view;
    const node = state.doc.nodeAt(blockMenu.pos);
    if (!node) return;
    const insertPos = blockMenu.pos + node.nodeSize;
    dispatch(state.tr.insert(insertPos, node.copy(node.content)));
    onClose();
  }, [editor, blockMenu, onClose]);

  // The trigger is a hidden button positioned offscreen; the handle extension clicks it
  return (
    <DropdownMenu open={!!blockMenu} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="pointer-events-none fixed opacity-0"
          style={blockMenu ? { top: blockMenu.rect.top, left: blockMenu.rect.left } : undefined}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GripVertical className="size-4" />
            Turn into
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {BLOCK_TYPES.filter((bt) => !["blockMath", "horizontalRule"].includes(bt.key)).map((bt) => (
              <DropdownMenuItem
                key={bt.key}
                onSelect={() => { applyBlockType(editor, bt.key); onClose(); }}
              >
                {bt.icon}
                {bt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={duplicateBlock}>
          <Copy className="size-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={deleteBlock} className="text-destructive focus:text-destructive">
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BubbleMenuToolbar({ editor }: { editor: Editor }) {
  const current = getCurrentBlockType(editor);
  return (
    <>
      <TurnIntoDropdown editor={editor} current={current} />
      <Sep />
      <MenuBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </MenuBtn>
      <MenuBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </MenuBtn>
      <MenuBtn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </MenuBtn>
      <MenuBtn title="Code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="size-4" />
      </MenuBtn>
      <Sep />
      <LinkMenuBtn editor={editor} />
    </>
  );
}

function FloatingMenuToolbar({ editor }: { editor: Editor }) {
  return (
    <>
      <MenuBtn title="Type / for commands" onClick={() => editor.chain().focus().insertContent("/").run()}>
        <Plus className="size-4" />
      </MenuBtn>
      <MenuBtn title="Heading 1" onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}>
        <Heading1 className="size-4" />
      </MenuBtn>
      <MenuBtn title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-4" />
      </MenuBtn>
      <MenuBtn title="Task list" onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListTodo className="size-4" />
      </MenuBtn>
      <MenuBtn title="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table className="size-4" />
      </MenuBtn>
      <span className="px-1 text-xs text-muted-foreground">Type / for more</span>
    </>
  );
}

function TurnIntoDropdown({ editor, current }: { editor: Editor; current: (typeof BLOCK_TYPES)[number] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onMouseDown={(e) => e.preventDefault()}>
          {current.icon}
          <span>{current.label}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {BLOCK_TYPES.filter((bt) => !["blockMath", "horizontalRule"].includes(bt.key)).map((bt) => (
          <DropdownMenuItem
            key={bt.key}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => applyBlockType(editor, bt.key)}
            className={cn(bt.key === current.key && "bg-accent")}
          >
            {bt.icon}
            {bt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinkMenuBtn({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const activeHref = editor.getAttributes("link").href as string | undefined;

  useEffect(() => {
    if (open) setHref(activeHref ?? "");
  }, [activeHref, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant={editor.isActive("link") ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onMouseDown={(e) => e.preventDefault()} title="Link">
          <Link2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Input
          value={href}
          onChange={(e) => setHref(e.target.value)}
          placeholder="https://example.com"
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (href.trim()) { editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run(); setOpen(false); }
            }
          }}
        />
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setOpen(false); }} disabled={!editor.isActive("link")}>
            Remove
          </Button>
          <Button type="button" size="sm" onClick={() => { if (href.trim()) { editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run(); setOpen(false); } }} disabled={!href.trim()}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuBtn({ children, onClick, active = false, title }: { children: ReactNode; onClick: () => void; active?: boolean; title: string }) {
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}>
      {children}
    </Button>
  );
}

function Sep() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}

function createSlashCommands(): SlashCommandItem[] {
  return [
    { title: "Text", subtitle: "Plain text", icon: <Pilcrow className="size-4" />, searchTerms: ["paragraph"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setParagraph().run(); } },
    { title: "Heading 1", subtitle: "Large heading", icon: <Heading1 className="size-4" />, searchTerms: ["h1", "title"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(); } },
    { title: "Heading 2", subtitle: "Medium heading", icon: <Heading2 className="size-4" />, searchTerms: ["h2", "subtitle"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(); } },
    { title: "Heading 3", subtitle: "Small heading", icon: <Heading3 className="size-4" />, searchTerms: ["h3"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(); } },
    { title: "Bullet list", subtitle: "Unordered list", icon: <List className="size-4" />, searchTerms: ["ul"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBulletList().run(); } },
    { title: "Numbered list", subtitle: "Ordered list", icon: <ListOrdered className="size-4" />, searchTerms: ["ol"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleOrderedList().run(); } },
    { title: "Task list", subtitle: "Checklist", icon: <ListTodo className="size-4" />, searchTerms: ["todo", "checkbox"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleTaskList().run(); } },
    { title: "Quote", subtitle: "Blockquote", icon: <Quote className="size-4" />, searchTerms: ["blockquote"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBlockquote().run(); } },
    { title: "Code block", subtitle: "Fenced code", icon: <Code className="size-4" />, searchTerms: ["code", "snippet"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleCodeBlock().run(); } },
    { title: "Divider", subtitle: "Horizontal rule", icon: <Minus className="size-4" />, searchTerms: ["hr", "separator"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHorizontalRule().run(); } },
    { title: "Table", subtitle: "3x3 table", icon: <Table className="size-4" />, searchTerms: ["grid"], command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
    { title: "Image", subtitle: "Embed by URL", icon: <ImagePlus className="size-4" />, searchTerms: ["photo", "media"], command: ({ editor, range }) => { const src = window.prompt("Image URL"); if (!src?.trim()) return; editor.chain().focus().deleteRange(range).setImage({ src: src.trim() }).run(); } },
    { title: "Inline math", subtitle: "Inline LaTeX", icon: <Sigma className="size-4" />, searchTerms: ["math", "latex"], command: ({ editor, range }) => { const latex = window.prompt("Inline LaTeX", "x^2"); if (!latex?.trim()) return; editor.chain().focus().deleteRange(range).insertInlineMath({ latex: latex.trim() }).run(); } },
    { title: "Block math", subtitle: "Display equation", icon: <Sigma className="size-4" />, searchTerms: ["equation", "latex"], command: ({ editor, range }) => { const latex = window.prompt("Block LaTeX", "\\int_0^1 x^2 \\, dx"); if (!latex?.trim()) return; editor.chain().focus().deleteRange(range).insertBlockMath({ latex: latex.trim() }).run(); } },
  ];
}
