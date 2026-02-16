'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { cn } from '@/lib/utils';
import { TemplateVariable } from './template-variable-extension';
import {
  extractExpressionFromText,
  filterTemplateVariables,
  getExpressionGroup,
  templateStringToDoc,
} from './template-variable-utils';
import { TEMPLATE_DRAG_ACTIVE_CLASS } from './template-editor-constants';
import { useTemplateVariableOptions } from './use-template-variable-options';
import type { TemplateVariableCompletion, TemplateVariableOption } from './types';

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  compact?: boolean;
  nodeId?: string | null;
  rows?: number;
  verticalAlign?: 'top' | 'bottom';
}

export function TemplateEditor({
  value,
  onChange,
  placeholder,
  multiline = false,
  compact = false,
  nodeId = null,
  rows,
  verticalAlign = 'top',
}: TemplateEditorProps) {
  const options = useTemplateVariableOptions(nodeId);
  const optionsRef = useRef<TemplateVariableOption[]>(options);
  const metaRef = useRef({
    exprMap: new Map<string, TemplateVariableOption>(),
    groupHasData: new Map<string, boolean>(),
  });
  const lastValueRef = useRef(value);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const lastDragPosRef = useRef<number | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    const exprMap = new Map<string, TemplateVariableOption>();
    const groupHasData = new Map<string, boolean>();

    for (const option of options) {
      exprMap.set(option.expr, option);
      if (!option.group) continue;
      if (!groupHasData.has(option.group)) {
        groupHasData.set(option.group, option.hasData ?? true);
        continue;
      }
      if (option.hasData ?? true) {
        groupHasData.set(option.group, true);
      }
    }

    metaRef.current = { exprMap, groupHasData };
  }, [options]);

  const getSuggestions = useCallback(
    (query: string) => filterTemplateVariables(optionsRef.current, query),
    []
  );

  const getPreview = useCallback((expr: string) => {
    return optionsRef.current.find(option => option.expr === expr)?.preview;
  }, []);

  const getMeta = useCallback((expr: string) => {
    const { exprMap, groupHasData } = metaRef.current;
    const option = exprMap.get(expr);
    if (option) {
      return { isValid: true, hasData: option.hasData ?? true };
    }

    const group = getExpressionGroup(expr);
    if (group && groupHasData.has(group)) {
      return { isValid: false, hasData: groupHasData.get(group) ?? true };
    }

    return { isValid: false, hasData: true };
  }, []);

  const getCompletions = useCallback(
    ({ prefix, query, trigger }: { prefix: string; query: string; trigger: '.' | '[' }) => {
      const options = optionsRef.current;
      const completions: TemplateVariableCompletion[] = [];
      const seen = new Set<string>();
      const normalizedQuery = query.trim();
      const prefixWithoutDot = prefix.endsWith('.') ? prefix.slice(0, -1) : null;

      for (const option of options) {
        let matchedPrefix: string | null = null;
        if (option.expr.startsWith(prefix)) {
          matchedPrefix = prefix;
        } else if (
          prefixWithoutDot
          && option.expr.startsWith(prefixWithoutDot)
          && option.expr.charAt(prefixWithoutDot.length) === '['
        ) {
          matchedPrefix = prefixWithoutDot;
        }

        if (!matchedPrefix) continue;

        const remainder = option.expr.slice(matchedPrefix.length);
        const segment = getNextSegment(remainder);
        if (!segment) continue;

        if (normalizedQuery) {
          const matchesQuery = segment.startsWith(normalizedQuery)
            || (segment.startsWith('[') && segment.slice(1).startsWith(normalizedQuery));
          if (!matchesQuery) continue;
        }

        const insertText = trigger === '[' && segment.startsWith('[')
          ? segment.slice(1)
          : segment;
        const label = segment;
        const fullExpr = `${matchedPrefix}${insertText}`;
        const preview = options.find(item => item.expr === fullExpr)?.preview ?? option.preview;
        const key = `${label}|${insertText}`;

        if (seen.has(key)) continue;
        seen.add(key);
        completions.push({ label, insertText, preview });
      }

      if (completions.length === 0 && trigger === '[') {
        const arrayExpr = prefix.endsWith('[') ? prefix.slice(0, -1) : prefix;
        const arrayOption = options.find(option => option.expr === arrayExpr);
        if (arrayOption) {
          completions.push({
            label: '[0]',
            insertText: '0]',
            preview: arrayOption.preview,
          });
        }
      }

      return completions;
    },
    []
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        History,
        Placeholder.configure({
          placeholder: placeholder ?? '',
        }),
        TemplateVariable.configure({
          getSuggestions,
          getPreview,
          getMeta,
          getCompletions,
        }),
      ],
      content: templateStringToDoc(value ?? ''),
      editorProps: buildEditorProps({
        multiline,
        compact,
        lastDragPosRef,
        onTemplateDrop: () => {
          setIsDragOver(false);
          dragDepthRef.current = 0;
          document.body.classList.remove(TEMPLATE_DRAG_ACTIVE_CLASS);
        },
      }),
    },
    [multiline, compact, placeholder]
  );

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const nextValue = getEditorText(editor, multiline);
      if (nextValue === lastValueRef.current) return;
      lastValueRef.current = nextValue;
      onChange(nextValue);
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor, multiline, onChange]);

  useEffect(() => {
    if (!editor) return;

    if (value === lastValueRef.current) return;

    const currentValue = getEditorText(editor, multiline);
    if (currentValue === value) {
      lastValueRef.current = value;
      return;
    }

    editor.commands.setContent(templateStringToDoc(value ?? ''), { emitUpdate: false });
    lastValueRef.current = value;
  }, [editor, multiline, value]);

  useEffect(() => {
    if (editor) return;
    lastValueRef.current = value;
  }, [editor, value]);

  useEffect(() => {
    const handleDragEnd = () => {
      setIsDragOver(false);
      dragDepthRef.current = 0;
      document.body.classList.remove(TEMPLATE_DRAG_ACTIVE_CLASS);
    };

    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('drop', handleDragEnd);

    return () => {
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('drop', handleDragEnd);
    };
  }, []);

  const isTemplateDrag = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const text = event.dataTransfer?.getData('text/plain');
    if (!text) return false;
    return Boolean(extractExpressionFromText(text.trim()));
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isTemplateDrag(event)) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, [isTemplateDrag]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isTemplateDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, [isTemplateDrag]);

  const alignBottom = multiline && verticalAlign === 'bottom';

  const wrapperClassName = cn(
    'nodrag w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] cursor-text',
    'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
    'dark:bg-input/30',
    compact ? 'text-xs' : 'text-sm',
    multiline ? 'px-3 py-2' : 'px-3 py-1.5',
    !multiline && (compact ? 'h-7' : 'h-8'),
    !multiline && 'overflow-x-auto',
    !multiline && 'flex items-center',
    multiline && (compact ? 'min-h-[44px]' : 'min-h-[60px]'),
    alignBottom && 'flex flex-col justify-end',
    'template-editor-dropzone',
    isDragOver && 'template-editor-dropzone-active'
  );

  const rowMinHeight = rows && multiline
    ? { minHeight: `${Math.max(rows, 2) * (compact ? 16 : 20)}px` }
    : undefined;

  const handleWrapperMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ProseMirror')) return;

    event.preventDefault();

    const rect = editor.view.dom.getBoundingClientRect();
    const clampedX = Math.min(Math.max(event.clientX, rect.left + 1), rect.right - 1);
    const clampedY = Math.min(Math.max(event.clientY, rect.top + 1), rect.bottom - 1);
    const coords = editor.view.posAtCoords({ left: clampedX, top: clampedY });
    const pos = coords?.pos ?? 1;

    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, pos))
    );
    editor.view.focus();
  }, [editor]);

  return (
    <div
      className={wrapperClassName}
      style={rowMinHeight}
      onMouseDown={handleWrapperMouseDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={() => {
        setIsDragOver(false);
        dragDepthRef.current = 0;
      }}
    >
      <EditorContent
        editor={editor}
        className={cn('template-editor', alignBottom ? 'w-full' : 'flex-1')}
      />
    </div>
  );
}

function buildEditorProps({
  multiline,
  compact,
  lastDragPosRef,
  onTemplateDrop,
}: {
  multiline: boolean;
  compact: boolean;
  lastDragPosRef: MutableRefObject<number | null>;
  onTemplateDrop?: () => void;
}) {
  return {
    attributes: {
      class: cn(
        'template-editor-content outline-none',
        compact ? 'text-xs' : 'text-sm',
        multiline ? 'whitespace-pre-wrap' : 'whitespace-pre',
        'text-foreground'
      ),
    },
    handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
      if (!multiline && event.key === 'Enter') {
        event.preventDefault();
        return true;
      }
      return false;
    },
    handleDragOver: (view: EditorView, event: DragEvent) => {
      const text = event.dataTransfer?.getData('text/plain');
      if (!text) return false;
      if (!event.dataTransfer) return false;

      const expr = extractExpressionFromText(text.trim());
      if (!expr) return false;

      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      const pos = coords?.pos ?? view.state.selection.from;
      if (lastDragPosRef.current !== pos) {
        lastDragPosRef.current = pos;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      view.focus();
      return true;
    },
    handleDrop: (view: EditorView, event: DragEvent) => {
      const text = event.dataTransfer?.getData('text/plain');
      if (!text) return false;

      const expr = extractExpressionFromText(text.trim());
      if (!expr) return false;

      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      const pos = coords?.pos ?? view.state.selection.from;

      const attrs = {
        preview: null,
      };

      const templateVar = view.state.schema.nodes.templateVar;
      if (!templateVar) return false;

      event.preventDefault();
      const contentNode = view.state.schema.text(expr);
      view.dispatch(view.state.tr.replaceWith(pos, pos, templateVar.create(attrs, contentNode)));
      onTemplateDrop?.();
      return true;
    },
  };
}

function getEditorText(editor: { getText: (options?: { blockSeparator?: string }) => string }, multiline: boolean): string {
  return editor.getText({ blockSeparator: multiline ? '\n' : ' ' });
}

function getNextSegment(remainder: string): string {
  if (!remainder) return '';

  if (remainder.startsWith('[')) {
    const end = remainder.indexOf(']');
    if (end === -1) return '';
    return remainder.slice(0, end + 1);
  }

  const match = remainder.match(/^[^.\[]+/);
  return match ? match[0] : '';
}
